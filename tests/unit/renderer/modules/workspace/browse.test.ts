import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import type { QueryResult, SelectResult } from "@/core/database"
import type { ConnResponse } from "@/preload/bridge"
import client from "@/renderer/modules/database/client"
import {
  activeTabIdAtom,
  activeViewTabAtom,
  cancelViewAtom,
  openViewTabAtom,
  refreshViewAtom,
  resetViewLayoutAtom,
  selectTabAtom,
  setViewPageAtom,
  setViewPageSizeAtom,
  setViewRangeAtom,
  setViewSortAtom,
} from "@/renderer/modules/workspace"

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
let env: Awaited<ReturnType<typeof setupWorkspace>>
beforeEach(async () => {
  env = await setupWorkspace()
})
afterEach(async () => {
  await env.dispose()
})

test("paging and refresh commands keep the explicit target when another tab is active", async () => {
  const select = mock<typeof env.bridge.select>(
    async (_config, _tab, _request, query) =>
      env.ok({
        result: query.select ? { ...result, rows: [[300]] } : result,
        executedSql: "browse SQL",
      }),
  )
  env.bridge.select = select
  const first = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "first" },
  })
  const second = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "second" },
  })
  await store.set(setViewPageAtom, { tabId: first, page: 2 })
  expect(select.mock.calls.at(-1)?.[1]).toBe(first)
  expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
    offset: 100,
    limit: 100,
  })
  await store.set(setViewPageSizeAtom, { tabId: first, limit: 50 })
  expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
    offset: 0,
    limit: 50,
  })
  await store.set(setViewRangeAtom, {
    tabId: first,
    offset: 125,
    limit: 50,
  })
  const count = select.mock.calls.length
  await store.set(refreshViewAtom, { tabId: first })
  const refreshed = select.mock.calls.slice(count)
  expect(refreshed.length).toBeGreaterThan(0)
  expect(refreshed.every((call) => call[1] === first)).toBe(true)
  expect(store.get(activeTabIdAtom)).toBe(second)
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    offset: 0,
    limit: 100,
  })
  store.set(selectTabAtom, first)
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    offset: 125,
    limit: 50,
  })
})

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
  await store.set(setViewSortAtom, { tabId, sort: [], order: ["b", "a"] })
  expect(select).toHaveBeenCalledTimes(calls)
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
  const other = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "other" },
  })
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual([])
  store.set(selectTabAtom, tabId)
  await store.set(setViewPageAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    page: 2,
  })
  store.set(resetViewLayoutAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
  env.bridge.select = async () => ({
    ok: false,
    kind: "error",
    error: "failed",
    snapshot: env.capture(),
  })
  await store.set(setViewSortAtom, {
    tabId,
    sort: [{ column: "a", direction: "asc" }],
    order: ["a", "b"],
  })
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["b", "a"])
  await store.set(setViewSortAtom, { tabId, sort: [], order: ["a", "b"] })
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual(["a", "b"])
  store.set(selectTabAtom, other)
  expect(store.get(activeViewTabAtom)?.table.sortOrder).toEqual([])
})

test.each([
  ["success", false],
  ["failure", true],
] as const)(
  "browse cancellation stays with its tab and clears after completion (%s)",
  async (_case, failed) => {
    env.bridge.select = async () => env.ok({ result, executedSql: "SELECT 1" })
    const first = await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "first" },
    })
    const other = await store.set(openViewTabAtom, {
      configId: "db",
      source: { schema: "public", table: "other" },
    })
    store.set(selectTabAtom, first)
    const page = Promise.withResolvers<ConnResponse<SelectResult>>()
    env.bridge.select = () => page.promise
    const running = store.set(refreshViewAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    const pending = Promise.withResolvers<void>()
    const cancel = mock<typeof env.bridge.cancel>(async () => {
      await pending.promise
      return env.ok(undefined)
    })
    env.bridge.cancel = cancel
    const table = store.get(activeViewTabAtom)?.table
    const requests = [table?.requestId, table?.countRequestId].filter(
      (id) => id !== undefined,
    )
    const stopped = store
      .set(cancelViewAtom, { tabId: store.get(activeTabIdAtom) ?? "" })
      .then(
        () => null,
        (error: unknown) => error,
      )
    try {
      expect(store.get(activeViewTabAtom)?.cancelling).toBe(true)
      await store.set(cancelViewAtom, {
        tabId: store.get(activeTabIdAtom) ?? "",
      })
      const cancelled = cancel.mock.calls.map((call) => call[0])
      expect(new Set(cancelled)).toEqual(new Set(requests))
      expect(cancelled).toHaveLength(new Set(cancelled).size)
      store.set(selectTabAtom, other)
      expect(store.get(activeViewTabAtom)?.table.status).toBe("success")
      expect(store.get(activeViewTabAtom)?.cancelling).toBeFalsy()
      store.set(selectTabAtom, first)
      expect(store.get(activeViewTabAtom)?.cancelling).toBe(true)
      store.set(selectTabAtom, other)

      if (failed) pending.reject(new Error("cancel denied"))
      else pending.resolve()
      const error = await stopped
      expect(error instanceof Error).toBe(failed)
      expect(store.get(activeViewTabAtom)?.id).toBe(other)
      store.set(selectTabAtom, first)
      expect(store.get(activeViewTabAtom)?.table.status).toBe("running")
      expect(store.get(activeViewTabAtom)?.cancelling).toBeFalsy()
      page.resolve(env.ok({ result, executedSql: "SELECT 1" }))
      await running
      expect(store.get(activeViewTabAtom)?.table.status).toBe("success")
    } finally {
      pending.resolve()
      page.resolve(env.ok({ result, executedSql: "SELECT 1" }))
      await Promise.all([stopped, running])
    }
  },
)

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
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: 125,
    limit: 50,
  })
  expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
    offset: 125,
    limit: 50,
  })
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    offset: 125,
    limit: 50,
  })
  for (const [page, offset] of [
    [3, 75],
    [2, 25],
    [1, 0],
    [2, 50],
    [100, 200],
  ]) {
    await store.set(setViewPageAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
      page: page,
    })
    expect(select.mock.calls.at(-1)?.[3]).toMatchObject({ offset, limit: 50 })
  }
  await store.set(setViewPageSizeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    limit: 100,
  })
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    offset: 0,
    limit: 100,
  })
  const calls = select.mock.calls.length
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: 0,
    limit: 100,
  })
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: -1,
    limit: 50,
  })
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: 0,
    limit: 0,
  })
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: Number.MAX_SAFE_INTEGER,
    limit: 50,
  })
  await store.set(setViewPageAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    page: 1.5,
  })
  expect(select).toHaveBeenCalledTimes(calls)
  env.bridge.select = async () => ({
    ok: false,
    kind: "error",
    error: "failed",
    snapshot: env.capture(),
  })
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: 125,
    limit: 50,
  })
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    offset: 0,
    limit: 100,
    status: "error",
  })
})

test("multi-column priority is sent once and invalid changes send no request", async () => {
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
        executedSql: "sorted SQL",
      }),
  )
  env.bridge.select = select
  const tabId = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  await store.set(setViewRangeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    offset: 125,
    limit: 50,
  })
  select.mockClear()
  const sort = [
    { column: "b", direction: "desc" as const },
    { column: "a", direction: "asc" as const },
  ]
  await store.set(setViewSortAtom, { order: columnOrder(), tabId, sort })
  expect(select).toHaveBeenCalledTimes(1)
  expect(select.mock.calls[0][3]).toMatchObject({
    orderBy: sort,
    offset: 0,
    limit: 50,
  })
  expect(store.get(activeViewTabAtom)?.table.sql).toBe("sorted SQL")
  await store.set(setViewSortAtom, {
    order: columnOrder(),
    tabId,
    sort: [...sort],
  })
  await store.set(setViewSortAtom, {
    order: columnOrder(),
    tabId,
    sort: [sort[0], sort[0]],
  })
  await store.set(setViewSortAtom, {
    order: columnOrder(),
    tabId,
    sort: [{ column: "missing" }],
  })
  expect(select).toHaveBeenCalledTimes(1)
  await store.set(setViewSortAtom, {
    order: columnOrder(),
    tabId,
    sort: [],
  })
  expect(select).toHaveBeenCalledTimes(2)
  expect(select.mock.calls[1][3].orderBy).toBeUndefined()
  expect(store.get(activeViewTabAtom)?.table.sort).toEqual([])
})

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
  await store.set(setViewPageAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    page: 2,
  })
  const pending = Promise.withResolvers<ConnResponse<SelectResult>>()
  env.bridge.select = mock(() => pending.promise)
  const sort = [{ column: "sort value", direction: "desc" as const }]
  const running = store.set(setViewSortAtom, {
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
    await store.set(setViewSortAtom, {
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
    store.set(resetViewLayoutAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    expect(store.get(activeViewTabAtom)?.table.sort).toEqual(sort)
    env.bridge.select = select
    await store.set(setViewPageAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
      page: 2,
    })
    expect(select.mock.calls.at(-1)?.[3]).toMatchObject({
      offset: 100,
      orderBy: [{ column: "sort value", direction: "desc" }],
    })
    await store.set(setViewSortAtom, {
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
    await store.set(setViewPageAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
      page: 2,
    })
    const before = store.get(activeViewTabAtom)?.table
    env.bridge.select = async () => ({
      ok: false,
      kind,
      error: "failed",
      snapshot: env.capture(),
    })
    await store.set(setViewSortAtom, {
      order: columnOrder(),
      tabId,
      sort: [{ column: "n", direction: "asc" }],
    })
    await store.set(setViewPageAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
      page: 3,
    })
    await store.set(setViewPageSizeAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
      limit: 50,
    })
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

test.each([
  ["page first", false],
  ["count first", true],
] as const)(
  "count and data responses keep separate results (%s)",
  async (_case, countFirst) => {
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
      await opening
      expect(store.get(activeViewTabAtom)?.table.sql).toBe("page SQL")
      expect(store.get(activeViewTabAtom)?.table.totalCount).toBe(250)
      expect(store.get(activeViewTabAtom)?.table.data).toHaveLength(1)
    } finally {
      unsubscribe()
      page.resolve(env.ok(data))
      count.resolve(env.ok(total))
      await opening
    }
  },
)
