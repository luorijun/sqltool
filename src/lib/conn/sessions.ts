import { randomUUID } from "node:crypto"
import type {
  Config,
  ConnResponse,
  ConnSnapshot,
  SelectQuery,
  SessionSnapshot,
} from "."
import { type ConnectionSession, connectDriver } from "./driver"
import { ConnError, Tasks, withTimeout } from "./tasks"

interface Session extends SessionSnapshot {
  owner: number
  profile: Config
  client?: ConnectionSession
  opening?: Promise<ConnectionSession>
  unwatch?: () => void
}

interface Options {
  configs: () => Config[]
  connect?: typeof connectDriver
  confirm: (
    owner: number,
    message: string,
    detail: string,
    force?: boolean,
  ) => Promise<boolean>
  limit?: number
}

export class Sessions {
  private entries = new Map<string, Session>()
  private tasks = new Tasks()
  private blocked = new Set<string>()
  private owners = new Set<number>()
  private tabs = new Set<string>()
  private closing = new Set<string>()
  private schemas = new Map<
    string,
    ConnSnapshot["connections"][number]["schema"]
  >()
  private errors = new Map<string, string>()
  private generations = new Map<string, number>()
  private version = 0
  private options: Options

  constructor(options: Options) {
    this.options = options
  }

  snapshot(owner: number): ConnSnapshot {
    const entries = [...this.entries.values()]
    return {
      version: ++this.version,
      connections: this.options.configs().map((config) => {
        const sessions = entries.filter((s) => s.configId === config.id)
        return {
          config,
          connected: sessions.some((s) => s.status === "ready"),
          sessionCount: sessions.filter(
            (s) => s.status !== "closed" && s.status !== "failed",
          ).length,
          failedCount: sessions.filter((s) => s.status === "failed").length,
          schema: this.schemas.get(config.id) ?? null,
          error: this.errors.get(config.id) ?? null,
          generation: this.generations.get(config.id) ?? 0,
        }
      }),
      sessions: entries
        .filter((s) => s.owner === owner)
        .map(({ id, configId, tabId, kind, status, used, error }) => ({
          id,
          configId,
          tabId,
          kind,
          status,
          used,
          error,
        })),
      tasks: this.tasks.snapshot(owner),
    }
  }

  async respond<T>(
    owner: number,
    run: () => T | Promise<T>,
  ): Promise<ConnResponse<T>> {
    try {
      const value = await run()
      return { ok: true, value, snapshot: this.snapshot(owner) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        kind: error instanceof ConnError ? error.kind : "error",
        snapshot: this.snapshot(owner),
      }
    }
  }

  hasResources(configId: string): boolean {
    return (
      this.blocked.has(configId) ||
      [...this.entries.values()].some(
        (s) =>
          s.configId === configId &&
          (s.opening || (s.status !== "closed" && s.status !== "failed")),
      )
    )
  }

  forget(configId: string): void {
    this.schemas.delete(configId)
    this.errors.delete(configId)
    for (const [id, session] of this.entries)
      if (session.configId === configId) this.entries.delete(id)
  }

  private check(configId: string, owner: number, tabId?: string): Config {
    if (
      this.blocked.has(configId) ||
      this.owners.has(owner) ||
      (tabId && this.tabs.has(`${owner}:${tabId}`))
    )
      throw new Error("正在关闭，请稍后再试")
    const config = this.options.configs().find((c) => c.id === configId)
    if (!config) throw new Error("连接不存在或已删除")
    return config
  }

  private get(id: string, owner: number): Session {
    const session = this.entries.get(id)
    if (!session || session.owner !== owner || session.kind !== "sql")
      throw new Error("会话不存在或不属于当前窗口")
    return session
  }

  private create(
    configId: string,
    owner: number,
    kind: Session["kind"],
    tabId?: string,
  ): Session {
    const profile = this.check(configId, owner, tabId)
    const existing = [...this.entries.values()].find(
      (s) =>
        s.configId === configId &&
        s.kind === kind &&
        (kind !== "sql" || (s.owner === owner && s.tabId === tabId)),
    )
    if (
      existing &&
      existing.status !== "closed" &&
      existing.status !== "failed"
    ) {
      if (this.closing.has(existing.id)) throw new Error("会话正在关闭")
      return existing
    }
    const count = [...this.entries.values()].filter(
      (s) => s.status !== "closed" && s.status !== "failed",
    ).length
    if (count >= (this.options.limit ?? 32))
      throw new Error("已达到会话上限，请关闭不再使用的标签页或连接")
    if (existing) this.entries.delete(existing.id)
    const session: Session = {
      id: randomUUID(),
      configId,
      owner,
      kind,
      tabId,
      profile: structuredClone(profile),
      status: "idle",
      used: false,
      error: null,
    }
    this.entries.set(session.id, session)
    return session
  }

  open(configId: string, owner: number, tabId: string): string {
    if (!tabId) throw new Error("缺少标签页编号")
    if (
      [...this.entries.values()].some(
        (s) =>
          s.kind === "sql" &&
          s.owner === owner &&
          s.tabId === tabId &&
          s.configId !== configId &&
          s.status !== "closed",
      )
    )
      throw new Error("请先关闭标签页原有会话")
    return this.create(configId, owner, "sql", tabId).id
  }

  private ensure(session: Session): Promise<ConnectionSession> {
    if (
      session.status === "closed" ||
      session.status === "closing" ||
      session.status === "failed"
    )
      return Promise.reject(
        new Error(session.error ?? "会话已关闭，请建立新会话"),
      )
    if (session.client) return Promise.resolve(session.client)
    if (session.opening) return session.opening
    session.status = "connecting"
    session.opening = (this.options.connect ?? connectDriver)(session.profile)
      .then((client) => {
        if (session.status !== "connecting") {
          client.destroy()
          throw new Error("会话在建立连接时已关闭")
        }
        session.client = client
        session.status = "ready"
        session.unwatch = client.onFailure((error) => {
          if (session.status === "closed") return
          session.status = "failed"
          session.error = error.message
          if (session.kind === "schema")
            this.errors.set(session.configId, error.message)
          this.tasks.fail(session.id, error.message)
          client.destroy()
          session.client = undefined
        })
        if (!session.client) throw new Error(session.error ?? "连接已失效")
        return client
      })
      .catch((error) => {
        if (session.status !== "closed" && session.status !== "closing") {
          session.status = "failed"
          session.error = error instanceof Error ? error.message : String(error)
        }
        throw error
      })
      .finally(() => {
        session.opening = undefined
      })
    return session.opening
  }

  async connect(configId: string, owner: number): Promise<void> {
    const session = this.create(configId, owner, "schema")
    try {
      await this.ensure(session)
      if (
        this.entries.get(session.id) === session &&
        session.status === "ready"
      )
        this.errors.delete(configId)
    } catch (error) {
      if (
        this.entries.get(session.id) === session &&
        session.status !== "closed"
      )
        this.errors.set(
          configId,
          error instanceof Error ? error.message : String(error),
        )
      throw error
    }
  }

  private run<T>(
    session: Session,
    owner: number,
    requestId: string,
    tabId: string | undefined,
    run: (client: ConnectionSession) => Promise<T>,
  ): Promise<T> {
    this.check(session.configId, owner, tabId)
    if (this.closing.has(session.id)) throw new Error("会话正在关闭")
    return this.tasks.run(
      { id: requestId, sessionId: session.id, owner, tabId },
      async (start) => {
        const client = await this.ensure(session)
        start(() => client.cancel())
        if (session.kind === "sql") session.used = true
        return run(client)
      },
    )
  }

  query(id: string, owner: number, requestId: string, sql: string) {
    const session = this.get(id, owner)
    return this.run(session, owner, requestId, session.tabId, (client) =>
      client.query(sql),
    )
  }

  select(
    configId: string,
    owner: number,
    tabId: string,
    requestId: string,
    query: SelectQuery,
  ) {
    const session = this.create(configId, owner, "browse")
    return this.run(session, owner, requestId, tabId, (client) =>
      client.select(query),
    )
  }

  async inspect(configId: string, owner: number): Promise<void> {
    const session = this.create(configId, owner, "schema")
    try {
      const schema = await this.run(
        session,
        owner,
        randomUUID(),
        undefined,
        (client) => client.inspect(),
      )
      if (
        this.entries.get(session.id) === session &&
        session.status === "ready"
      ) {
        this.schemas.set(configId, schema)
        this.errors.delete(configId)
      }
    } catch (error) {
      if (
        this.entries.get(session.id) === session &&
        session.status !== "closed"
      )
        this.errors.set(
          configId,
          error instanceof Error ? error.message : String(error),
        )
      throw error
    }
  }

  cancel(id: string, owner: number) {
    return this.tasks.cancel(id, owner)
  }

  private destroy(session: Session): void {
    session.status = "closed"
    session.unwatch?.()
    this.tasks.fail(session.id, "会话已断开")
    session.client?.destroy()
    session.client = undefined
    // ensure() destroys any connection that arrives after this point.
  }

  private async close(
    entries: Session[],
    owner: number,
    force = false,
  ): Promise<boolean> {
    if (force) {
      for (const session of entries) this.destroy(session)
      return true
    }
    if (entries.some((s) => this.closing.has(s.id)))
      throw new Error("正在关闭，请稍后再试")
    for (const s of entries) this.closing.add(s.id)
    try {
      if (!force && entries.some((s) => s.used && s.status !== "closed")) {
        const accepted = await this.options.confirm(
          owner,
          "回滚并关闭会话？",
          "这些会话执行过 SQL，可能存在未提交事务。将停止任务并尝试回滚，临时表和会话设置也会丢失。已经提交的更改不会撤销。",
        )
        if (!accepted) return false
      }
      for (const session of entries) {
        try {
          await this.tasks.stop(session.id)
          if (session.opening) await withTimeout(session.opening)
          if (session.used && session.status === "failed")
            throw new Error(session.error ?? "连接已失效，无法确认回滚结果")
          if (session.used && session.client) {
            const client = session.client
            // A timed-out rollback stays in the lane until it settles or is cancelled.
            await withTimeout(
              this.tasks.run(
                { id: randomUUID(), sessionId: session.id, owner },
                async (start) => {
                  start(() => client.cancel())
                  return client.query("ROLLBACK")
                },
              ),
            )
          }
          session.status = "closing"
          session.unwatch?.()
          if (session.client) await session.client.close()
          this.destroy(session)
        } catch (error) {
          session.error = error instanceof Error ? error.message : String(error)
          const accepted = await this.options.confirm(
            owner,
            "无法确认停止或回滚，强制断开？",
            `${session.error}\n服务端执行结果可能未知，强制断开不会保证此前语句已回滚。`,
            true,
          )
          if (!accepted) return false
          this.destroy(session)
        }
      }
      return true
    } finally {
      for (const s of entries) this.closing.delete(s.id)
    }
  }

  closeSession(id: string, owner: number): Promise<boolean> {
    return this.close([this.get(id, owner)], owner)
  }

  async closeTab(owner: number, tabId: string): Promise<boolean> {
    const key = `${owner}:${tabId}`
    if (this.tabs.has(key)) throw new Error("标签页正在关闭")
    this.tabs.add(key)
    try {
      const entries = [...this.entries.values()].filter(
        (s) => s.owner === owner && s.tabId === tabId,
      )
      // Browse tasks share their connection; cancel only this tab's requests.
      if (entries.length === 0) await this.tasks.stopTab(owner, tabId)
      const closed = await this.close(entries, owner)
      if (closed) for (const s of entries) this.entries.delete(s.id)
      return closed
    } finally {
      this.tabs.delete(key)
    }
  }

  async disconnect(configId: string, owner: number): Promise<boolean> {
    this.check(configId, owner)
    this.blocked.add(configId)
    try {
      const closed = await this.close(
        [...this.entries.values()].filter((s) => s.configId === configId),
        owner,
      )
      if (closed) {
        this.generations.set(
          configId,
          (this.generations.get(configId) ?? 0) + 1,
        )
        this.errors.delete(configId)
      }
      return closed
    } finally {
      this.blocked.delete(configId)
    }
  }

  async closeOwner(owner: number, force = false): Promise<boolean> {
    if (this.owners.has(owner) && !force) return false
    this.owners.add(owner)
    try {
      const entries = [...this.entries.values()].filter(
        (s) => s.owner === owner,
      )
      const closed = await this.close(entries, owner, force)
      if (closed) for (const s of entries) this.entries.delete(s.id)
      return closed
    } finally {
      this.owners.delete(owner)
    }
  }
}
