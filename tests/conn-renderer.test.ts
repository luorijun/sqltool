import { beforeEach, describe, expect, test } from "bun:test"
import { getDefaultStore } from "jotai"
import type {
  Config,
  ConnResponse,
  ConnSnapshot,
  QueryResult,
  SelectQuery,
  SelectResult,
} from "../src/contracts/database"
import connApi, {
  applySnapshot,
  connectConnectionAtom,
  connectionActionAtom,
  disconnectConnectionAtom,
  refreshConnectionSchemaAtom,
  refreshConnectionsAtom,
  snapshotAtom,
} from "../src/renderer/modules/database/client"
import {
  activeQueryTabAtom,
  activeResultStaleAtom,
  activeViewTabAtom,
  bindQueryConfigAtom,
  clearLogsAtom,
  closeTabAtom,
  openQueryTabAtom,
  openViewTabAtom,
  rebuildActiveSessionAtom,
  refreshActiveViewTabAtom,
  runActiveQueryTabSqlAtom,
  selectTabAtom,
  setActiveViewTabPageAtom,
  tabsAtom,
  updateLogViewAtom,
  updateQueryEditorAtom,
  updateQueryLayoutAtom,
  updateViewCodeAtom,
} from "../src/renderer/modules/workspace"

const store = getDefaultStore()
const config: Config = {
  id: "db",
  driver: "postgres",
  host: "localhost",
  port: "5432",
  username: "u",
  password: "p",
  database: "db",
  createdAt: 0,
  updatedAt: 0,
}
let version = 0
let snapshot: ConnSnapshot
let queryCalls = 0
let selectCalls: SelectQuery[] = []
const result: QueryResult = { columns: [], rows: [[1]], rowCount: 1 }
const capture = () => structuredClone({ ...snapshot, version: ++version })
const ok = <T>(value: T): ConnResponse<T> => ({
  ok: true,
  value,
  snapshot: capture(),
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { resolve, promise }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
let bridge: typeof window.main.conn
beforeEach(async () => {
  snapshot = {
    version: 0,
    connections: [
      {
        config,
        connected: true,
        error: null,
        schema: null,
        sessionCount: 0,
        failedCount: 0,
        generation: 0,
      },
    ],
    sessions: [],
    tasks: [],
  }
  queryCalls = 0
  selectCalls = []
  bridge = {
    sync: async () => capture(),
    openSession: async (configId, tabId) => {
      const id = crypto.randomUUID()
      snapshot.sessions.push({
        id,
        configId,
        tabId,
        kind: "sql",
        status: "ready",
        used: false,
        error: null,
      })
      return ok(id)
    },
    closeTab: async (tabId) => {
      snapshot.sessions = snapshot.sessions.filter((s) => s.tabId !== tabId)
      return ok(true)
    },
    query: async () => {
      queryCalls++
      return ok(result)
    },
    select: async (_configId, _tabId, _requestId, query) => {
      selectCalls.push(query)
      return ok({
        result: { ...result, rows: [[500]] },
        executedSql: query.select
          ? "SELECT COUNT(*) FROM items"
          : `SELECT * FROM items LIMIT ${query.limit} OFFSET ${query.offset}`,
      })
    },
    cancel: async () => ok(undefined),
  } as typeof bridge
  globalThis.window = { main: { conn: bridge } } as unknown as Window &
    typeof globalThis
  applySnapshot(capture())
  for (const tab of store.get(tabsAtom)) await store.set(closeTabAtom, tab.id)
})

describe("sidebar connection actions", () => {
  test("connecting loads structure once and rejects conflicting actions until it finishes", async () => {
    const ready = deferred<void>()
    const calls: string[] = []
    snapshot.connections[0].connected = false
    applySnapshot(capture())
    bridge.connect = async () => {
      calls.push("connect")
      await ready.promise
      snapshot.connections[0].connected = true
      return ok(undefined)
    }
    bridge.inspect = async () => {
      calls.push("inspect")
      snapshot.connections[0].schema = [
        { name: "public", tables: [], views: [], functions: [] },
      ]
      return ok(undefined)
    }
    const first = store.set(connectConnectionAtom, "db")
    const second = store.set(connectConnectionAtom, "db")
    expect(store.get(connectionActionAtom).db).toBe("connect")
    await expect(store.set(disconnectConnectionAtom, "db")).rejects.toThrow(
      "正在处理中",
    )
    ready.resolve()
    await Promise.all([first, second])
    expect(calls).toEqual(["connect", "inspect"])
    expect(store.get(snapshotAtom)?.connections[0].schema).toHaveLength(1)
    expect(store.get(connectionActionAtom).db).toBeUndefined()
  })

  test("a structure failure keeps the connection available and permits a targeted retry", async () => {
    const source = { schema: "public", table: "items" }
    bridge.connect = async () => ok(undefined)
    bridge.inspect = async () => {
      throw new Error("结构读取失败")
    }
    await expect(store.set(connectConnectionAtom, "db")).rejects.toThrow(
      "结构读取失败",
    )
    expect(store.get(snapshotAtom)?.connections[0].connected).toBe(true)
    expect(store.get(connectionActionAtom).db).toBeUndefined()
    bridge.inspect = async (id, target) => {
      expect(id).toBe("db")
      expect(target).toEqual(source)
      return ok(undefined)
    }
    await store.set(refreshConnectionSchemaAtom, { id: "db", source })
    expect(selectCalls).toHaveLength(0)
    expect(queryCalls).toBe(0)
  })

  test("a failed connection never inspects, and a cancelled disconnect preserves its result", async () => {
    let inspected = false
    bridge.connect = async () => {
      throw new Error("连接失败")
    }
    bridge.inspect = async () => {
      inspected = true
      return ok(undefined)
    }
    await expect(store.set(connectConnectionAtom, "db")).rejects.toThrow(
      "连接失败",
    )
    expect(inspected).toBe(false)
    bridge.disconnect = async () => ok(false)
    expect(await store.set(disconnectConnectionAtom, "db")).toBeUndefined()
    expect(store.get(snapshotAtom)?.connections[0].connected).toBe(true)
  })
})

describe("table view tabs", () => {
  const source = { schema: "public", table: "items" }
  const open = () => store.set(openViewTabAtom, { configId: "db", source })
  const getView = () => {
    const tab = store.get(activeViewTabAtom)
    if (!tab) throw new Error("Missing view tab")
    return tab
  }

  test("table operations use structured queries and keep SQL separate from logs", async () => {
    const id = await open()
    expect(selectCalls).toEqual([
      { from: source, limit: 100, offset: 0 },
      { from: source, select: [{ aggregate: "count", alias: "total" }] },
    ])
    expect(store.get(activeViewTabAtom)?.table.sql).toBe(
      "SELECT * FROM items LIMIT 100 OFFSET 0",
    )
    expect(store.get(activeViewTabAtom)?.table.totalCount).toBe(500)
    store.set(clearLogsAtom, id)
    expect(store.get(activeViewTabAtom)?.logger.logs).toEqual([])
    expect(store.get(activeViewTabAtom)?.table.sql).toBe(
      "SELECT * FROM items LIMIT 100 OFFSET 0",
    )
    await store.set(setActiveViewTabPageAtom, 1)
    expect(store.get(activeViewTabAtom)?.table.sql).toBe(
      "SELECT * FROM items LIMIT 100 OFFSET 100",
    )
    expect(await open()).toBe(id)
    expect(selectCalls).toHaveLength(3)
    await store.set(runActiveQueryTabSqlAtom)
    expect(queryCalls).toBe(0)
    expect(store.get(activeQueryTabAtom)).toBeNull()
  })

  test.each([
    true,
    false,
  ])("count responses never replace data SQL (count first: %s)", async (countFirst) => {
    const page = deferred<ConnResponse<SelectResult>>()
    const count = deferred<ConnResponse<SelectResult>>()
    bridge.select = (_configId, _tabId, _requestId, query) =>
      query.select ? count.promise : page.promise
    const opening = open()
    expect(store.get(activeViewTabAtom)?.table.sql).toBe("")
    const finishPage = () =>
      page.resolve(ok({ result, executedSql: "SELECT * FROM items" }))
    const finishCount = () =>
      count.resolve(
        ok({
          result: { ...result, rows: [[500]] },
          executedSql: "SELECT COUNT(*) FROM items",
        }),
      )
    if (countFirst) finishCount()
    else finishPage()
    await tick()
    expect(store.get(activeViewTabAtom)?.table.sql).toBe(
      countFirst ? "" : "SELECT * FROM items",
    )
    if (countFirst) finishPage()
    else finishCount()
    await opening
    expect(store.get(activeViewTabAtom)?.table.sql).toBe("SELECT * FROM items")
    expect(
      store.get(activeViewTabAtom)?.logger.logs.map((log) => log.sql),
    ).toEqual(["SELECT * FROM items", "SELECT COUNT(*) FROM items"])
  })

  test("failed refresh keeps the previous result and its SQL", async () => {
    await open()
    const before = getView()
    bridge.select = async () => {
      throw new Error("connection lost")
    }
    await store.set(refreshActiveViewTabAtom)
    const after = getView()
    expect(after.table.status).toBe("error")
    expect(after.table.sql).toBe(before.table.sql)
    expect(after.table.data).toBe(before.table.data)
  })

  test("code callbacks retain tab identity and cannot replace generated SQL", async () => {
    const id = await open()
    const before = getView()
    const queryId = store.set(openQueryTabAtom, { initialSql: "query draft" })
    const view = {
      ...before.code,
      text: "DELETE FROM items",
      scroll: { top: 40, left: 10 },
      search: { ...before.code.search, query: "items", open: true },
    }
    store.set(updateViewCodeAtom, { tabId: id, view })
    store.set(updateQueryEditorAtom, {
      tabId: id,
      update: (current) => ({ ...current, text: "UPDATE items" }),
    })
    store.set(updateViewCodeAtom, { tabId: queryId, view })
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("query draft")
    store.set(selectTabAtom, id)
    expect(store.get(activeViewTabAtom)?.table.sql).toBe(before.table.sql)
    expect(store.get(activeViewTabAtom)?.code.scroll).toEqual(view.scroll)
    expect(store.get(activeViewTabAtom)?.code.search).toEqual(view.search)
    expect(store.get(activeViewTabAtom)?.code).not.toHaveProperty("text")
    await store.set(closeTabAtom, id)
    store.set(updateViewCodeAtom, { tabId: id, view })
    expect(store.get(tabsAtom).map((tab) => tab.id)).toEqual([queryId])
  })

  test("late data updates its original tab and cannot recreate a closed tab", async () => {
    for (const close of [false, true]) {
      const page = deferred<ConnResponse<SelectResult>>()
      const count = deferred<ConnResponse<SelectResult>>()
      bridge.select = (_configId, _tabId, _requestId, query) =>
        query.select ? count.promise : page.promise
      const opening = store.set(openViewTabAtom, {
        configId: "db",
        source: { ...source, table: String(close) },
      })
      const id = getView().id
      const queryId = store.set(openQueryTabAtom, { initialSql: "keep draft" })
      if (close) await store.set(closeTabAtom, id)
      page.resolve(ok({ result, executedSql: "SELECT * FROM items" }))
      count.resolve(
        ok({
          result: { ...result, rows: [[500]] },
          executedSql: "SELECT COUNT(*) FROM items",
        }),
      )
      await opening
      expect(store.get(activeQueryTabAtom)?.id).toBe(queryId)
      expect(store.get(activeQueryTabAtom)?.editor.text).toBe("keep draft")
      if (close)
        expect(store.get(tabsAtom).some((tab) => tab.id === id)).toBe(false)
      else {
        store.set(selectTabAtom, id)
        expect(store.get(activeViewTabAtom)?.table.sql).toBe(
          "SELECT * FROM items",
        )
      }
    }
  })
})

describe("query config binding", () => {
  const addConfig = () => {
    snapshot.connections.push({
      ...snapshot.connections[0],
      config: { ...config, id: "other", name: "Other database" },
    })
    applySnapshot(capture())
  }

  test("binding a draft does not connect or run SQL until requested", async () => {
    const tabId = store.set(openQueryTabAtom, { initialSql: "SELECT 1" })
    await store.set(bindQueryConfigAtom, { tabId, configId: "db" })
    expect(store.get(activeQueryTabAtom)?.configId).toBe("db")
    expect(snapshot.sessions).toEqual([])
    expect(queryCalls).toBe(0)
    await store.set(runActiveQueryTabSqlAtom)
    expect(snapshot.sessions[0].configId).toBe("db")
    expect(queryCalls).toBe(1)
  })

  test("switching closes the old session, preserves the draft and marks prior results stale", async () => {
    addConfig()
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await store.set(runActiveQueryTabSqlAtom)
    const before = store.get(activeQueryTabAtom)
    await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
    const after = store.get(activeQueryTabAtom)
    expect(after?.configId).toBe("other")
    expect(after?.sessionId).toBeUndefined()
    expect(after?.editor).toEqual(before?.editor)
    expect(after?.table).toEqual(before?.table)
    expect(after?.logger).toEqual(before?.logger)
    expect(store.get(activeResultStaleAtom)).toBe(true)
    expect(snapshot.sessions).toEqual([])
    expect(queryCalls).toBe(1)
    await store.set(runActiveQueryTabSqlAtom)
    expect(snapshot.sessions[0].configId).toBe("other")
    await store.set(bindQueryConfigAtom, { tabId })
    expect(store.get(activeQueryTabAtom)?.configId).toBeUndefined()
    expect(snapshot.sessions).toEqual([])
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 1")
  })

  test("declining or failing session closure preserves the existing binding", async () => {
    addConfig()
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await store.set(runActiveQueryTabSqlAtom)
    const before = store.get(activeQueryTabAtom)
    const close = bridge.closeTab
    bridge.closeTab = async () => ok(false)
    await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
    expect(store.get(activeQueryTabAtom)).toEqual({ ...before, closing: false })
    bridge.closeTab = async () => {
      throw new Error("close failed")
    }
    await expect(
      store.set(bindQueryConfigAtom, { tabId, configId: "other" }),
    ).rejects.toThrow("close failed")
    expect(store.get(activeQueryTabAtom)).toEqual({ ...before, closing: false })
    bridge.closeTab = close
  })

  test("rejects missing configs and ignores view tabs or running queries", async () => {
    const viewId = await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "items" },
    })
    await store.set(bindQueryConfigAtom, { tabId: viewId })
    expect(store.get(activeViewTabAtom)?.configId).toBe("db")
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await expect(
      store.set(bindQueryConfigAtom, { tabId, configId: "missing" }),
    ).rejects.toThrow("连接配置不存在或已删除")
    expect(store.get(activeQueryTabAtom)?.closing).toBeFalsy()
    const pending = deferred<ConnResponse<QueryResult>>()
    bridge.query = () => pending.promise
    const running = store.set(runActiveQueryTabSqlAtom)
    await tick()
    await store.set(bindQueryConfigAtom, { tabId })
    expect(store.get(activeQueryTabAtom)?.configId).toBe("db")
    pending.resolve(ok(result))
    await running
  })

  test("pending binding stays with its tab and blocks concurrent binding or execution", async () => {
    addConfig()
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await store.set(runActiveQueryTabSqlAtom)
    const pending = deferred<ConnResponse<boolean>>()
    const close = bridge.closeTab
    bridge.closeTab = () => pending.promise
    const switching = store.set(bindQueryConfigAtom, {
      tabId,
      configId: "other",
    })
    await store.set(bindQueryConfigAtom, { tabId })
    await store.set(runActiveQueryTabSqlAtom)
    expect(queryCalls).toBe(1)
    const second = store.set(openQueryTabAtom, { initialSql: "second draft" })
    store.set(updateQueryEditorAtom, {
      tabId,
      update: (state) => ({ ...state, text: "SELECT 2" }),
    })
    pending.resolve(await close(tabId))
    await switching
    expect(store.get(activeQueryTabAtom)?.id).toBe(second)
    expect(store.get(activeQueryTabAtom)?.configId).toBeUndefined()
    store.set(selectTabAtom, tabId)
    expect(store.get(activeQueryTabAtom)?.configId).toBe("other")
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 2")
    expect(store.get(activeQueryTabAtom)?.closing).toBe(false)
    bridge.closeTab = close
  })
})

describe("renderer state", () => {
  test("saving applies the response snapshot without a follow-up sync", async () => {
    let syncCalls = 0
    bridge.sync = async () => {
      syncCalls++
      throw new Error("sync unavailable")
    }
    const created = { ...config, id: "created" }
    bridge.create = async () => {
      snapshot.connections.push({ ...snapshot.connections[0], config: created })
      return ok(created)
    }
    bridge.update = async (_id, input) => {
      const updated = { ...created, ...input }
      snapshot.connections[1].config = updated
      return ok(updated)
    }
    expect(await connApi.create(config)).toEqual(created)
    expect(store.get(snapshotAtom)?.connections[1].config).toEqual(created)
    expect(await connApi.update(created.id, { name: "edited" })).toMatchObject({
      name: "edited",
    })
    expect(store.get(snapshotAtom)?.connections[1].config.name).toBe("edited")
    expect(syncCalls).toBe(0)
    await expect(store.set(refreshConnectionsAtom)).rejects.toThrow(
      "sync unavailable",
    )
    expect(syncCalls).toBe(1)
    expect(store.get(snapshotAtom)?.connections[1].config.name).toBe("edited")
  })

  test("an old response cannot replace a newer snapshot", () => {
    const old = capture(),
      fresh = capture()
    fresh.connections = []
    applySnapshot(fresh)
    applySnapshot(old)
    expect(store.get(snapshotAtom)?.connections).toEqual([])
  })
  test("failure responses update session state before surfacing the error", async () => {
    bridge.query = async () => {
      snapshot.sessions = [
        {
          id: "lost",
          configId: "db",
          tabId: "a",
          kind: "sql",
          status: "failed",
          used: true,
          error: "lost",
        },
      ]
      return {
        ok: false,
        kind: "unknown",
        error: "结果未知",
        snapshot: capture(),
      }
    }
    await expect(connApi.query("lost", "q", "UPDATE x")).rejects.toMatchObject({
      kind: "unknown",
    })
    expect(store.get(snapshotAtom)?.sessions[0].status).toBe("failed")
  })
  test("rebuilding a session preserves text and results without executing SQL", async () => {
    store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
    await store.set(runActiveQueryTabSqlAtom)
    const before = store.get(activeQueryTabAtom)
    if (!before) throw new Error("Missing query tab")
    await store.set(rebuildActiveSessionAtom)
    const after = store.get(activeQueryTabAtom)
    if (!after) throw new Error("Missing rebuilt tab")
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(after.table.data).toEqual(before.table.data)
    expect(after.editor.text).toBe("SELECT 1")
    expect(queryCalls).toBe(1)
  })
  test("late query results cannot recreate a closed tab", async () => {
    const pending = deferred<ConnResponse<QueryResult>>()
    bridge.query = () => pending.promise
    const id = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    const running = store.set(runActiveQueryTabSqlAtom)
    await tick()
    const oldResult = ok(result)
    await store.set(closeTabAtom, id)
    pending.resolve(oldResult)
    await running
    expect(store.get(tabsAtom)).toEqual([])
    expect(store.get(activeQueryTabAtom)).toBeNull()
    expect(store.get(snapshotAtom)?.sessions).toEqual([])
  })
  test("a late result updates its old log without replacing the rebuilt session's result", async () => {
    const pending = deferred<ConnResponse<QueryResult>>()
    bridge.query = () => pending.promise
    store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
    const oldRun = store.set(runActiveQueryTabSqlAtom)
    await tick()
    const oldResult = ok(result)
    await store.set(rebuildActiveSessionAtom)
    bridge.query = async () => ok({ ...result, rows: [[99]] })
    await store.set(runActiveQueryTabSqlAtom)
    const fresh = store.get(activeQueryTabAtom)
    pending.resolve(oldResult)
    await oldRun
    expect(store.get(activeQueryTabAtom)?.table.data).toEqual(fresh?.table.data)
    expect(store.get(activeQueryTabAtom)?.sessionId).toBe(fresh?.sessionId)
    expect(
      store
        .get(activeQueryTabAtom)
        ?.logger.logs.some((log) => log.status === "running"),
    ).toBe(false)
  })
  test("closing during the open response prevents SQL and closes the late session", async () => {
    const pending = deferred<ConnResponse<string>>()
    const originalOpen = bridge.openSession
    bridge.openSession = async (id, tabId) => {
      await originalOpen(id, tabId)
      return pending.promise
    }
    const id = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "DELETE FROM x",
    })
    const running = store.set(runActiveQueryTabSqlAtom)
    await tick()
    const closing = store.set(closeTabAtom, id)
    pending.resolve(ok(snapshot.sessions[0].id))
    await Promise.all([running, closing])
    expect(queryCalls).toBe(0)
    expect(snapshot.sessions).toEqual([])
    expect(store.get(tabsAtom)).toEqual([])
  })
  test("a closed session is not silently recreated or replayed", async () => {
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await store.set(runActiveQueryTabSqlAtom)
    snapshot.sessions[0].status = "closed"
    applySnapshot(capture())
    store.set(updateQueryEditorAtom, {
      tabId,
      update: (current) => ({
        ...current,
        text: "UPDATE x",
      }),
    })
    await store.set(runActiveQueryTabSqlAtom)
    expect(queryCalls).toBe(1)
    expect(store.get(activeQueryTabAtom)?.table.error).toContain("会话已失效")
  })

  test("editor callbacks retain their tab identity after switching and cannot revive a closed tab", async () => {
    const first = store.set(openQueryTabAtom, { initialSql: "first" })
    const second = store.set(openQueryTabAtom, { initialSql: "second" })
    store.set(updateQueryEditorAtom, {
      tabId: first,
      update: (current) => ({ ...current, text: "edited" }),
    })
    expect(store.get(activeQueryTabAtom)?.id).toBe(second)
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("second")
    store.set(selectTabAtom, first)
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("edited")
    await store.set(closeTabAtom, first)
    store.set(updateQueryEditorAtom, {
      tabId: first,
      update: (current) => ({ ...current, text: "late" }),
    })
    expect(store.get(tabsAtom).map((tab) => tab.id)).toEqual([second])
  })

  test("view commands cannot replace query results, execution status or logs", async () => {
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    await store.set(runActiveQueryTabSqlAtom)
    const tab = store.get(activeQueryTabAtom)
    store.set(updateQueryLayoutAtom, {
      tabId,
      update: (current) => ({
        ...current,
        data: [],
        status: "running",
        visibility: { hidden: false },
      }),
    })
    store.set(updateQueryEditorAtom, {
      tabId,
      update: (current) => ({
        ...current,
        status: "running",
        text: "SELECT 2",
      }),
    })
    store.set(updateLogViewAtom, {
      tabId,
      update: (current) => ({ ...current, query: "filter", logs: [] }),
    })
    const updated = store.get(activeQueryTabAtom)
    expect(updated?.table.data).toBe(tab?.table.data)
    expect(updated?.table.status).toBe("success")
    expect(updated?.table.visibility).toEqual({ hidden: false })
    expect(updated?.editor.status).toBe("idle")
    expect(updated?.logger.logs).toBe(tab?.logger.logs)
    expect(updated?.logger.query).toBe("filter")
    store.set(clearLogsAtom, tabId)
    expect(store.get(activeQueryTabAtom)?.logger.logs).toEqual([])
  })
})
