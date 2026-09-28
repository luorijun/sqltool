import { beforeEach, describe, expect, test } from "bun:test"
import { getDefaultStore } from "jotai"
import type {
  Config,
  ConnResponse,
  ConnSnapshot,
  QueryResult,
} from "../src/lib/conn"
import connApi, {
  applySnapshot,
  connSnapshotAtom,
} from "../src/lib/conn/renderer"
import {
  activeQueryTabAtom,
  activeQueryTabEditorStateAtom,
  closeTabAtom,
  openQueryTabAtom,
  rebuildActiveSessionAtom,
  runActiveQueryTabSqlAtom,
  tabsAtom,
} from "../src/lib/tabs/renderer"

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
beforeEach(() => {
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
  bridge = {
    sync: async () => capture(),
    list: async () => capture(),
    get: async () => capture(),
    openSession: async (_configId, tabId) => {
      const id = crypto.randomUUID()
      snapshot.sessions.push({
        id,
        configId: "db",
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
    cancel: async () => ok(undefined),
  } as typeof bridge
  globalThis.window = { main: { conn: bridge } } as unknown as Window &
    typeof globalThis
  applySnapshot(capture())
  store.set(tabsAtom, [])
})

describe("renderer state", () => {
  test("an old response cannot replace a newer snapshot", () => {
    const old = capture(),
      fresh = capture()
    fresh.connections = []
    applySnapshot(fresh)
    applySnapshot(old)
    expect(store.get(connSnapshotAtom)?.connections).toEqual([])
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
    expect(store.get(connSnapshotAtom)?.sessions[0].status).toBe("failed")
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
    expect(store.get(connSnapshotAtom)?.sessions).toEqual([])
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
    store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
    await store.set(runActiveQueryTabSqlAtom)
    snapshot.sessions[0].status = "closed"
    applySnapshot(capture())
    store.set(activeQueryTabEditorStateAtom, (current) => ({
      ...current,
      text: "UPDATE x",
    }))
    await store.set(runActiveQueryTabSqlAtom)
    expect(queryCalls).toBe(1)
    expect(store.get(activeQueryTabAtom)?.table.error).toContain("会话已失效")
  })
})
