import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { getDefaultStore } from "jotai"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
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
  cancelActiveViewAtom,
  closeTabAtom,
  copyOptionsAtom,
  getPagination,
  openQueryTabAtom,
  openViewTabAtom,
  rebuildActiveSessionAtom,
  refreshActiveViewTabAtom,
  resetActiveViewTabTableStateAtom,
  runActiveQueryTabSqlAtom,
  selectTabAtom,
  setActiveViewTabPageAtom,
  setActiveViewTabPageSizeAtom,
  setActiveViewTabRangeAtom,
  setTableSelectionAtom,
  setViewTabSortAtom,
  tabsAtom,
  updateQueryLayoutAtom,
  updateViewLayoutAtom,
} from "../../src/renderer/modules/workspace"
import ViewTableArea from "../../src/renderer/pages/workbench/workspace/tab-page/table-area/view"
import { config, renderer } from "../support/renderer"

const store = getDefaultStore()
const columnOrder = () =>
  store
    .get(activeViewTabAtom)
    ?.table.columns.map((column) => column.id)
    .reverse() ?? []
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
  test("inactive sort order is tab-owned, needs no SQL, and survives paging and layout reset", async () => {
    const data: QueryResult = {
      columns: ["a", "b"].map((id) => ({ id, name: id, typeFamily: "number" })),
      rows: [[1, 2]],
    }
    const select = mock<typeof env.bridge.select>(
      async (_config, _tab, _request, query) =>
        env.ok({
          result: query.select ? { ...result, rows: [[250]] } : data,
          executedSql: "SQL",
        }),
    )
    env.bridge.select = select
    const tabId = await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "items" },
    })
    const calls = select.mock.calls.length
    await store.set(setViewTabSortAtom, { tabId, sort: [], order: ["b", "a"] })
    expect(select).toHaveBeenCalledTimes(calls)
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
    const other = await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "other" },
    })
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual([])
    store.set(selectTabAtom, tabId)
    await store.set(setActiveViewTabPageAtom, 2)
    store.set(resetActiveViewTabTableStateAtom)
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
    env.bridge.select = async () => ({
      ok: false,
      kind: "error",
      error: "failed",
      snapshot: env.capture(),
    })
    await store.set(setViewTabSortAtom, {
      tabId,
      sort: [{ column: "a", direction: "asc" }],
      order: ["a", "b"],
    })
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
    await store.set(setViewTabSortAtom, { tabId, sort: [], order: ["a", "b"] })
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["a", "b"])
    store.set(selectTabAtom, other)
    expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual([])
  })

  test("toolbar switches one refresh/stop control and hides both totals while either request runs", async () => {
    env.bridge.select = async (_config, _tab, _request, query) =>
      env.ok({
        result: query.select ? { ...result, rows: [[250]] } : result,
        executedSql: "page SQL",
      })
    await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "items" },
    })
    const render = () => renderToStaticMarkup(createElement(ViewTableArea))
    let html = render()
    expect(html).toContain("共 250 行")
    expect(html).toContain("第 1 / 3 页")
    expect(html).toContain(">刷新</button>")
    expect(html).not.toContain(">停止</button>")
    expect(html.indexOf("排序：未排序")).toBeGreaterThan(
      html.indexOf("第 1 / 3 页"),
    )
    expect(html.indexOf("未选择")).toBeGreaterThan(html.indexOf("排序：未排序"))
    const page = Promise.withResolvers<ConnResponse<SelectResult>>()
    const count = Promise.withResolvers<ConnResponse<SelectResult>>()
    env.bridge.select = (_config, _tab, _request, query) =>
      query.select ? count.promise : page.promise
    const refreshed = store.set(refreshActiveViewTabAtom)
    try {
      html = render()
      expect(html).toContain("共 - 行")
      expect(html).toContain("第 1 / - 页")
      expect(html).toContain(">停止</button>")
      expect(html).not.toContain(">刷新</button>")
      const cancelled: string[] = []
      env.bridge.cancel = async (id) => {
        cancelled.push(id)
        return env.ok(undefined)
      }
      const table = store.get(activeViewTabAtom)?.table
      await store.set(cancelActiveViewAtom)
      expect(cancelled).toHaveLength(2)
      expect(new Set(cancelled)).toEqual(
        new Set(
          [table?.requestId, table?.countRequestId].filter(
            (id) => id !== undefined,
          ),
        ),
      )
      const loaded = Promise.withResolvers<void>()
      const unsubscribe = store.sub(activeViewTabAtom, () => {
        if (store.get(activeViewTabAtom)?.table.status === "success")
          loaded.resolve()
      })
      page.resolve(env.ok({ result, executedSql: "refreshed SQL" }))
      await loaded.promise
      unsubscribe()
      html = render()
      expect(html).toContain("共 - 行")
      expect(html).toContain(">停止</button>")
      count.resolve(
        env.ok({
          result: { ...result, rows: [[250]] },
          executedSql: "count SQL",
        }),
      )
      await refreshed
      expect(render()).toContain(">刷新</button>")
    } finally {
      page.resolve(env.ok({ result, executedSql: "page SQL" }))
      count.resolve(env.ok({ result, executedSql: "count SQL" }))
      await refreshed
    }
  })

  test("ranges and page navigation share SQL offsets, realign at home and retain state on failure", async () => {
    const select = mock<typeof env.bridge.select>(
      async (_config, _tab, _request, query) =>
        env.ok({
          result: query.select ? { ...result, rows: [[250]] } : result,
          executedSql: "page SQL",
        }),
    )
    env.bridge.select = select
    await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "items" },
    })
    await store.set(setActiveViewTabRangeAtom, { offset: 125, limit: 50 })
    expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
      offset: 125,
      limit: 50,
    })
    expect(store.get(activeViewTabAtom)?.table).toMatchObject({
      offset: 125,
      limit: 50,
    })
    expect(getPagination(125, 50, 250)).toEqual({ page: 4, totalPages: 6 })
    for (const [page, offset] of [
      [3, 75],
      [2, 25],
      [1, 0],
      [2, 50],
      [100, 200],
    ]) {
      await store.set(setActiveViewTabPageAtom, page)
      expect(select.mock.calls.at(-1)?.[3]).toMatchObject({ offset, limit: 50 })
    }
    await store.set(setActiveViewTabPageSizeAtom, 100)
    expect(store.get(activeViewTabAtom)?.table).toMatchObject({
      offset: 0,
      limit: 100,
    })
    const calls = select.mock.calls.length
    await store.set(setActiveViewTabRangeAtom, { offset: 0, limit: 100 })
    await store.set(setActiveViewTabRangeAtom, { offset: -1, limit: 50 })
    await store.set(setActiveViewTabRangeAtom, { offset: 0, limit: 0 })
    await store.set(setActiveViewTabRangeAtom, {
      offset: Number.MAX_SAFE_INTEGER,
      limit: 50,
    })
    await store.set(setActiveViewTabPageAtom, 1.5)
    expect(select).toHaveBeenCalledTimes(calls)
    env.bridge.select = async () => ({
      ok: false,
      kind: "error",
      error: "failed",
      snapshot: env.capture(),
    })
    await store.set(setActiveViewTabRangeAtom, { offset: 125, limit: 50 })
    expect(store.get(activeViewTabAtom)?.table).toMatchObject({
      offset: 0,
      limit: 100,
      status: "error",
    })
  })

  test.each(["postgres", "mysql"] as const)(
    "multi-column priority is sent once and compiled in order (%s)",
    async (driver) => {
      const { compileSelectQuery } = await import(
        "../../src/main/database/query"
      )
      const data: QueryResult = {
        columns: [
          { id: "a", name: "a", typeFamily: "number" },
          { id: "b", name: "b", typeFamily: "number" },
        ],
        rows: [[1, 2]],
      }
      const select = mock<typeof env.bridge.select>(
        async (_config, _tab, _request, query) =>
          env.ok({
            result: query.select ? { ...result, rows: [[250]] } : data,
            executedSql: compileSelectQuery(driver, query).sql,
          }),
      )
      env.bridge.select = select
      const tabId = await store.set(openViewTabAtom, {
        configId: "db",
        source: { schema: "public", table: "items" },
      })
      await store.set(setActiveViewTabRangeAtom, { offset: 125, limit: 50 })
      select.mockClear()
      const sort = [
        { column: "b", direction: "desc" as const },
        { column: "a", direction: "asc" as const },
      ]
      await store.set(setViewTabSortAtom, { order: columnOrder(), tabId, sort })
      expect(select).toHaveBeenCalledTimes(1)
      expect(select.mock.calls[0][3]).toMatchObject({
        orderBy: sort,
        offset: 0,
        limit: 50,
      })
      const quote = driver === "postgres" ? '"' : "`"
      expect(store.get(activeViewTabAtom)?.table.sql).toContain(
        `ORDER BY ${quote}b${quote} DESC, ${quote}a${quote} ASC`,
      )
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [...sort],
      })
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [sort[0], sort[0]],
      })
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [{ column: "missing" }],
      })
      expect(select).toHaveBeenCalledTimes(1)
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [],
      })
      expect(select).toHaveBeenCalledTimes(2)
      expect(store.get(activeViewTabAtom)?.table.sql).not.toContain("ORDER BY")
    },
  )

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
    expect(select.mock.calls[0][3].orderBy).toBeUndefined()
    await store.set(setActiveViewTabPageAtom, 2)
    const pending = Promise.withResolvers<ConnResponse<SelectResult>>()
    env.bridge.select = mock(() => pending.promise)
    const sort = [{ column: "sort value", direction: "desc" as const }]
    const running = store.set(setViewTabSortAtom, {
      order: columnOrder(),
      tabId,
      sort,
    })
    try {
      expect(env.bridge.select).toHaveBeenCalledWith(
        "db",
        tabId,
        expect.any(String),
        {
          from: source,
          limit: 100,
          offset: 0,
          orderBy: [{ column: "sort value", direction: "desc" }],
        },
      )
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        offset: 100,
        sort: [],
        sql: "initial SQL",
      })
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [],
      })
      expect(env.bridge.select).toHaveBeenCalledTimes(1)
      pending.resolve(env.ok({ result: data, executedSql: "sorted SQL" }))
      await running
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        offset: 0,
        sort,
        sql: "sorted SQL",
      })
      store.set(resetActiveViewTabTableStateAtom)
      expect(store.get(activeViewTabAtom)?.table.sort).toEqual(sort)
      env.bridge.select = select
      await store.set(setActiveViewTabPageAtom, 2)
      expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
        offset: 100,
        orderBy: [{ column: "sort value", direction: "desc" }],
      })
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [],
      })
      expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
        offset: 0,
      })
      expect(select.mock.calls.at(-1)?.[3].orderBy).toBeUndefined()
      expect(store.get(activeViewTabAtom)?.table.sort).toEqual([])
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
      await store.set(setActiveViewTabPageAtom, 2)
      const before = store.get(activeViewTabAtom)?.table
      env.bridge.select = async () => ({
        ok: false,
        kind,
        error: "failed",
        snapshot: env.capture(),
      })
      await store.set(setViewTabSortAtom, {
        order: columnOrder(),
        tabId,
        sort: [{ column: "n", direction: "asc" }],
      })
      await store.set(setActiveViewTabPageAtom, 3)
      await store.set(setActiveViewTabPageSizeAtom, 50)
      expect(store.get(activeViewTabAtom)?.table).toMatchObject({
        status: "error",
        offset: 100,
        limit: 100,
        sort: [],
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
        await store.set(setActiveViewTabPageAtom, 2)
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

test("table selection is tab-owned, survives sizing, and is cleared by result or column changes", async () => {
  env.bridge.query = async () => env.ok(result)
  env.bridge.select = async () => env.ok({ result, executedSql: "SELECT n" })
  const selection = {
    rows: [0],
    columns: ["n"],
    anchor: { row: 0, col: "n" },
    active: { row: 0, col: "n" },
    toggle: {
      rows: [],
      columns: [],
      mode: "cells" as const,
      operation: "add" as const,
    },
  }
  const query = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  await store.set(runActiveQueryTabSqlAtom)
  store.set(setTableSelectionAtom, { tabId: query, selection })
  store.set(updateQueryLayoutAtom, {
    tabId: query,
    update: (current) => ({ ...current, sizing: { n: 200 } }),
  })
  expect(store.get(activeQueryTabAtom)?.table.selection).toEqual(selection)
  const view = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: view, selection })
  store.set(updateViewLayoutAtom, {
    tabId: view,
    update: (current) => ({ ...current, pinning: { start: ["n"], end: [] } }),
  })
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: view, selection })
  await store.set(setActiveViewTabPageSizeAtom, 50)
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(selectTabAtom, query)
  expect(store.get(activeQueryTabAtom)?.table.selection).toEqual(selection)
  store.set(updateQueryLayoutAtom, {
    tabId: query,
    update: (current) => ({ ...current, visibility: { n: false } }),
  })
  expect(store.get(activeQueryTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: query, selection })
  await store.set(runActiveQueryTabSqlAtom)
  expect(store.get(activeQueryTabAtom)?.table.selection).toBeNull()
})

test("copy preferences are shared across tabs independently of selection and layout", () => {
  const first = store.set(openQueryTabAtom)
  store.set(copyOptionsAtom, { format: "json", headers: true })
  const second = store.set(openQueryTabAtom)
  expect(store.get(copyOptionsAtom)).toEqual({ format: "json", headers: true })
  store.set(selectTabAtom, first)
  expect(store.get(copyOptionsAtom).format).toBe("json")
  store.set(selectTabAtom, second)
  store.set(copyOptionsAtom, { format: "tsv", headers: false })
})
