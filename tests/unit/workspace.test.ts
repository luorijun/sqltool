import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { getDefaultStore } from "jotai"
import type {
  ConnResponse,
  QueryResult,
  SelectResult,
} from "../../src/contracts/database"
import client, {
  snapshotAtom,
} from "../../src/renderer/modules/database/client"
import {
  activeQueryTabAtom,
  activeResultStaleAtom,
  activeViewTabAtom,
  bindQueryConfigAtom,
  closeTabAtom,
  openQueryTabAtom,
  openViewTabAtom,
  rebuildActiveSessionAtom,
  resetActiveViewTabTableStateAtom,
  runActiveQueryTabSqlAtom,
  selectTabAtom,
  setActiveViewTabPageAtom,
  setActiveViewTabPageSizeAtom,
  setViewTabSortAtom,
  tabsAtom,
} from "../../src/renderer/modules/workspace"
import { config, renderer } from "../support/renderer"

const store = getDefaultStore()
const result: QueryResult = {
  columns: [{ id: "n", name: "n", typeFamily: "number" }],
  rows: [[1]],
  rowCount: 1,
}
let env: ReturnType<typeof renderer>
let close: ReturnType<typeof renderer>["bridge"]["closeTab"]
beforeEach(async () => {
  env = renderer(store.get(snapshotAtom)?.version ?? 0)
  env.bridge.openSession = async (configId, tabId) => {
    const id = crypto.randomUUID()
    env.snapshot.sessions.push({
      id,
      configId,
      tabId,
      kind: "sql",
      status: "ready",
      used: false,
      error: null,
    })
    return env.ok(id)
  }
  close = async (tabId) => {
    env.snapshot.sessions = env.snapshot.sessions.filter(
      (s) => s.tabId !== tabId,
    )
    return env.ok(true)
  }
  env.bridge.closeTab = close
  await client.sync()
})
afterEach(async () => {
  try {
    env.bridge.closeTab = close
    for (const tab of store.get(tabsAtom)) await store.set(closeTabAtom, tab.id)
    expect(store.get(tabsAtom)).toEqual([])
  } finally {
    env.restore()
  }
})

describe("query workspace", () => {
  test("changing a connection preserves the draft and requires a successful close", async () => {
    env.snapshot.connections.push({
      ...env.snapshot.connections[0],
      config: { ...config, id: "other" },
    })
    await client.sync()
    const query = mock(async () => env.ok(result))
    env.bridge.query = query
    const tabId = store.set(openQueryTabAtom, { initialSql: "SELECT 1" })
    await store.set(bindQueryConfigAtom, { tabId, configId: "db" })
    expect(env.snapshot.sessions).toEqual([])
    expect(query).not.toHaveBeenCalled()
    await store.set(runActiveQueryTabSqlAtom)
    const before = store.get(activeQueryTabAtom)
    env.bridge.closeTab = async () => env.ok(false)
    await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
    expect(store.get(activeQueryTabAtom)?.configId).toBe("db")
    env.bridge.closeTab = close
    await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
    expect(store.get(activeQueryTabAtom)?.configId).toBe("other")
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 1")
    expect(store.get(activeQueryTabAtom)?.table.data).toEqual(
      before?.table.data,
    )
    expect(store.get(activeResultStaleAtom)).toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
  })

  test.each([false, true])(
    "late query results stay with the original tab (closed: %s)",
    async (closed) => {
      const started = Promise.withResolvers<void>()
      const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
      env.bridge.query = () => {
        started.resolve()
        return pending.promise
      }
      const first = store.set(openQueryTabAtom, {
        configId: "db",
        initialSql: "SELECT 1",
      })
      const running = store.set(runActiveQueryTabSqlAtom)
      try {
        await started.promise
        const response = env.ok(result)
        const second = store.set(openQueryTabAtom, {
          initialSql: "second draft",
        })
        if (closed) await store.set(closeTabAtom, first)
        pending.resolve(response)
        await running
        expect(store.get(activeQueryTabAtom)?.id).toBe(second)
        expect(store.get(activeQueryTabAtom)?.editor.text).toBe("second draft")
        expect(store.get(activeQueryTabAtom)?.table.data).toEqual([])
        if (closed)
          expect(store.get(tabsAtom).some((tab) => tab.id === first)).toBe(
            false,
          )
        else {
          store.set(selectTabAtom, first)
          expect(store.get(activeQueryTabAtom)?.table.status).toBe("success")
          expect(store.get(activeQueryTabAtom)?.table.data).toHaveLength(1)
        }
      } finally {
        pending.resolve(env.ok(result))
        await running
      }
    },
  )

  test("rebuilding does not replay SQL and an older result cannot overwrite a new run", async () => {
    const started = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
    const query = mock(() => {
      started.resolve()
      return pending.promise
    })
    env.bridge.query = query
    store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
    const running = store.set(runActiveQueryTabSqlAtom)
    try {
      await started.promise
      const old = env.ok(result)
      await store.set(rebuildActiveSessionAtom)
      expect(query).toHaveBeenCalledTimes(1)
      expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 1")
      env.bridge.query = async () => env.ok({ ...result, rows: [[99]] })
      await store.set(runActiveQueryTabSqlAtom)
      const fresh = store.get(activeQueryTabAtom)?.table.data
      pending.resolve(old)
      await running
      expect(store.get(activeQueryTabAtom)?.table.data).toEqual(fresh)
      expect(
        store
          .get(activeQueryTabAtom)
          ?.logger.logs.some((log) => log.status === "running"),
      ).toBe(false)
    } finally {
      pending.resolve(env.ok(result))
      await running
    }
  })

  test("closing before session creation completes prevents SQL execution", async () => {
    const started = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<ConnResponse<string>>()
    env.bridge.openSession = () => {
      started.resolve()
      return pending.promise
    }
    const query = mock(async () => env.ok(result))
    env.bridge.query = query
    const id = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "DELETE FROM items",
    })
    const running = store.set(runActiveQueryTabSqlAtom)
    try {
      await started.promise
      const closing = store.set(closeTabAtom, id)
      pending.resolve(env.ok("late-session"))
      await Promise.all([running, closing])
      expect(query).not.toHaveBeenCalled()
      expect(store.get(tabsAtom)).toEqual([])
    } finally {
      pending.resolve(env.ok("late-session"))
      await running
    }
  })
})

describe("table workspace", () => {
  test("sorting uses source columns in SQL, resets paging only on success and survives layout reset", async () => {
    const source = { schema: "public", table: "items" }
    const data: QueryResult = {
      columns: [
        {
          id: "col_0",
          name: "Value",
          sourceColumn: "sort value",
          typeFamily: "number",
        },
      ],
      rows: [[2], [1]],
    }
    env.snapshot.connections[0].schema = [
      {
        name: "public",
        views: [],
        functions: [],
        tables: [
          { name: "items", columns: [{ name: "id", type: "int", pk: true }] },
        ],
      },
    ]
    await client.sync()
    const select = mock<typeof env.bridge.select>(
      async (_config, _tab, _request, query) =>
        env.ok({
          result: query.select ? { ...result, rows: [[250]] } : data,
          executedSql: "initial SQL",
        }),
    )
    env.bridge.select = select
    const tabId = await store.set(openViewTabAtom, { configId: "db", source })
    expect(select.mock.calls[0][3].orderBy).toEqual([
      { column: "id", direction: "asc" },
    ])
    await store.set(setActiveViewTabPageAtom, 1)
    const pending = Promise.withResolvers<ConnResponse<SelectResult>>()
    env.bridge.select = mock(() => pending.promise)
    const sort = { column: "sort value", direction: "desc" as const }
    const running = store.set(setViewTabSortAtom, { tabId, sort })
    try {
      expect(env.bridge.select).toHaveBeenCalledWith(
        "db",
        tabId,
        expect.any(String),
        {
          from: source,
          limit: 100,
          offset: 0,
          orderBy: [
            { column: "sort value", direction: "desc" },
            { column: "id", direction: "asc" },
          ],
        },
      )
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        pageIndex: 1,
        sort: null,
        sql: "initial SQL",
      })
      await store.set(setViewTabSortAtom, { tabId, sort: null })
      expect(env.bridge.select).toHaveBeenCalledTimes(1)
      pending.resolve(env.ok({ result: data, executedSql: "sorted SQL" }))
      await running
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        pageIndex: 0,
        sort,
        sql: "sorted SQL",
      })
      store.set(resetActiveViewTabTableStateAtom)
      expect(store.get(activeViewTabAtom)?.table.sort).toEqual(sort)
      env.bridge.select = select
      await store.set(setActiveViewTabPageAtom, 1)
      expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
        offset: 100,
        orderBy: [
          { column: "sort value", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
      })
      await store.set(setViewTabSortAtom, { tabId, sort: null })
      expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
        offset: 0,
        orderBy: [{ column: "id", direction: "asc" }],
      })
      expect(store.get(activeViewTabAtom)?.table.sort).toBeNull()
    } finally {
      pending.resolve(env.ok({ result: data, executedSql: "sorted SQL" }))
      await running
    }
  })

  test.each(["error", "cancelled"] as const)(
    "failed browse changes retain the applied query (%s)",
    async (kind) => {
      env.bridge.select = async (_config, _tab, _request, query) =>
        env.ok({
          result: query.select ? { ...result, rows: [[250]] } : result,
          executedSql: "previous SQL",
        })
      const tabId = await store.set(openViewTabAtom, {
        configId: "db",
        source: { schema: "public", table: "items" },
      })
      await store.set(setActiveViewTabPageAtom, 1)
      const before = store.get(activeViewTabAtom)?.table
      env.bridge.select = async () => ({
        ok: false,
        kind,
        error: "failed",
        snapshot: env.capture(),
      })
      await store.set(setViewTabSortAtom, {
        tabId,
        sort: { column: "n", direction: "asc" },
      })
      await store.set(setActiveViewTabPageAtom, 2)
      await store.set(setActiveViewTabPageSizeAtom, 50)
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        status: "error",
        pageIndex: 1,
        pageSize: 100,
        sort: null,
        sql: "previous SQL",
        data: before?.data,
      })
    },
  )

  test.each([false, true])(
    "count and data responses keep separate results (count first: %s)",
    async (countFirst) => {
      const page = Promise.withResolvers<ConnResponse<SelectResult>>()
      const count = Promise.withResolvers<ConnResponse<SelectResult>>()
      const source = { schema: "public", table: "items" }
      const select = mock<typeof env.bridge.select>(
        (_configId, _tabId, _requestId, query) =>
          query.select ? count.promise : page.promise,
      )
      env.bridge.select = select
      const opening = store.set(openViewTabAtom, { configId: "db", source })
      const data = { result, executedSql: "page SQL" }
      const total = {
        result: { ...result, rows: [[250]] },
        executedSql: "count SQL",
      }
      const received = Promise.withResolvers<void>()
      const unsubscribe = store.sub(activeViewTabAtom, () => {
        const table = store.get(activeViewTabAtom)?.table
        if (countFirst ? table?.totalCount === 250 : table?.sql === "page SQL")
          received.resolve()
      })
      try {
        if (countFirst) count.resolve(env.ok(total))
        else page.resolve(env.ok(data))
        await received.promise
        if (countFirst) page.resolve(env.ok(data))
        else count.resolve(env.ok(total))
        const id = await opening
        expect(store.get(activeViewTabAtom)?.table.sql).toBe("page SQL")
        expect(store.get(activeViewTabAtom)?.table.totalCount).toBe(250)
        expect(store.get(activeViewTabAtom)?.table.data).toHaveLength(1)
        env.bridge.select = mock(async () =>
          env.ok({ result, executedSql: "next page SQL" }),
        )
        await store.set(setActiveViewTabPageAtom, 1)
        expect(env.bridge.select).toHaveBeenCalledWith(
          "db",
          id,
          expect.any(String),
          { from: source, limit: 100, offset: 100 },
        )
        expect(store.get(activeViewTabAtom)?.table.sql).toBe("next page SQL")
        const query = mock(async () => env.ok(result))
        env.bridge.query = query
        await store.set(runActiveQueryTabSqlAtom)
        expect(query).not.toHaveBeenCalled()
      } finally {
        unsubscribe()
        page.resolve(env.ok(data))
        count.resolve(env.ok(total))
        await opening
      }
    },
  )
})
