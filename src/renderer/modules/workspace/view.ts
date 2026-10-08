import { atom } from "jotai"
import connApi, {
  connectionsAtom,
  RequestError,
} from "@/renderer/modules/database"
import { createLogEntry, trimLogs, upsertLogEntry } from "./logs"
import { getPagination, pageOffset } from "./pagination"
import {
  tabOrderAtom,
  tabStatesAtom,
  toTableRows,
  toTotalCount,
  updateLog,
  updateViewTab,
  updateViewTable,
} from "./state"
import type { ViewTableState } from "./types"

type ViewPage = { tabId: string } & Partial<
  Pick<ViewTableState, "offset" | "limit" | "sort" | "sortOrder">
>

export const loadViewPageAtom = atom(
  null,
  async (get, set, input: ViewPage) => {
    const { tabId } = input
    const tab = get(tabStatesAtom)[tabId]
    if (
      !tab ||
      tab.closing ||
      tab.kind !== "view" ||
      tab.table.status === "running"
    ) {
      return
    }

    const { offset, limit, sort, sortOrder } = {
      ...tab.table,
      ...input,
    }

    const requestId = crypto.randomUUID()
    const generation = get(connectionsAtom)?.find(
      (c) => c.config.id === tab.configId,
    )?.generation
    const isCurrent = () => {
      const current = get(tabStatesAtom)[tabId]
      return current?.kind === "view" && current.table.requestId === requestId
    }
    const startedAt = Date.now()
    const runningLog = createLogEntry("running", "", "正在加载数据表", {
      detail: `${tab.source.schema}.${tab.source.table}`,
      startedAt,
    })

    set(tabStatesAtom, (states) =>
      updateViewTable(states, tabId, (current) => ({
        ...current,
        requestId: requestId,
        status: "running",
        error: null,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateLog(states, tabId, (current) => ({
        ...current,
        logs: trimLogs([...current.logs, runningLog]),
      })),
    )

    try {
      const { result, executedSql } = await connApi.select(
        tab.configId,
        tabId,
        requestId,
        {
          from: tab.source,
          ...(sort.length ? { orderBy: sort } : {}),
          limit,
          offset,
        },
      )
      if (!isCurrent()) return
      const finishedAt = Date.now()
      const durationMs = Math.max(1, finishedAt - startedAt)

      set(tabStatesAtom, (states) =>
        updateViewTable(states, tabId, (current) => ({
          ...current,
          status: "success",
          error: null,
          dataAt: finishedAt,
          generation,
          sql: executedSql,
          offset,
          limit,
          sort,
          sortOrder,
          columns: result.columns,
          data: toTableRows(result),
          selection: null,
        })),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs(
            upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: "success",
              sql: executedSql,
              summary: `加载 ${result.rows.length} 行`,
              detail: undefined,
              finishedAt,
              durationMs,
            })),
          ),
        })),
      )
    } catch (error) {
      if (!isCurrent()) return
      const finishedAt = Date.now()
      const durationMs = Math.max(1, finishedAt - startedAt)
      const message = error instanceof Error ? error.message : "数据表加载失败"

      set(tabStatesAtom, (states) =>
        updateViewTable(states, tabId, (current) => ({
          ...current,
          status: "error",
          error: message,
        })),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs(
            upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: error instanceof RequestError ? error.kind : "error",
              summary: message,
              detail: message,
              finishedAt,
              durationMs,
            })),
          ),
        })),
      )
    }
  },
)

export const loadViewCountAtom = atom(null, async (get, set, tabId: string) => {
  const tab = get(tabStatesAtom)[tabId]
  if (
    !tab ||
    tab.closing ||
    tab.kind !== "view" ||
    tab.table.countStatus === "running"
  ) {
    return
  }

  const requestId = crypto.randomUUID()
  const isCurrent = () => {
    const current = get(tabStatesAtom)[tabId]
    return (
      current?.kind === "view" && current.table.countRequestId === requestId
    )
  }
  const startedAt = Date.now()
  const runningLog = createLogEntry("running", "", "正在统计数据表行数", {
    detail: `${tab.source.schema}.${tab.source.table}`,
    startedAt,
  })

  set(tabStatesAtom, (states) =>
    updateViewTable(states, tabId, (current) => ({
      ...current,
      countRequestId: requestId,
      countStatus: "running",
      countError: null,
    })),
  )
  set(tabStatesAtom, (states) =>
    updateLog(states, tabId, (current) => ({
      ...current,
      logs: trimLogs([...current.logs, runningLog]),
    })),
  )

  try {
    const { result, executedSql } = await connApi.select(
      tab.configId,
      tabId,
      requestId,
      {
        from: tab.source,
        select: [{ aggregate: "count", alias: "total" }],
      },
    )
    const totalCount = toTotalCount(result.rows[0]?.[0])
    if (!isCurrent()) return
    const finishedAt = Date.now()
    const durationMs = Math.max(1, finishedAt - startedAt)

    set(tabStatesAtom, (states) =>
      updateViewTable(states, tabId, (current) => ({
        ...current,
        totalCount,
        countStatus: "success",
        countError: null,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateLog(states, tabId, (current) => ({
        ...current,
        logs: trimLogs(
          upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
            ...(currentLog ?? runningLog),
            status: "success",
            sql: executedSql,
            summary: `共 ${totalCount.toLocaleString()} 行`,
            detail: undefined,
            finishedAt,
            durationMs,
          })),
        ),
      })),
    )
  } catch (error) {
    if (!isCurrent()) return
    const finishedAt = Date.now()
    const durationMs = Math.max(1, finishedAt - startedAt)
    const message = error instanceof Error ? error.message : "总行数统计失败"

    set(tabStatesAtom, (states) =>
      updateViewTable(states, tabId, (current) => ({
        ...current,
        totalCount: null,
        countStatus: "error",
        countError: message,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateLog(states, tabId, (current) => ({
        ...current,
        logs: trimLogs(
          upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
            ...(currentLog ?? runningLog),
            status: error instanceof RequestError ? error.kind : "error",
            summary: message,
            detail: message,
            finishedAt,
            durationMs,
          })),
        ),
      })),
    )
  }
})

export const refreshViewAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }) => {
    const tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "view") {
      return
    }
    await Promise.all([
      set(loadViewPageAtom, { tabId: tab.id }),
      set(loadViewCountAtom, tab.id),
    ])
  },
)

export const setViewRangeAtom = atom(
  null,
  async (
    get,
    set,
    { tabId, ...range }: { tabId: string; offset: number; limit: number },
  ) => {
    const tab = get(tabStatesAtom)[tabId]
    if (
      tab?.kind !== "view" ||
      tab.table.status === "running" ||
      !Number.isSafeInteger(range.offset) ||
      range.offset < 0 ||
      !Number.isSafeInteger(range.limit) ||
      range.limit <= 0 ||
      !Number.isSafeInteger(range.offset + range.limit) ||
      (range.offset === tab.table.offset && range.limit === tab.table.limit)
    )
      return
    await set(loadViewPageAtom, { tabId: tab.id, ...range })
  },
)

export const setViewPageAtom = atom(
  null,
  async (get, set, { tabId, page }: { tabId: string; page: number }) => {
    const tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "view" || !Number.isSafeInteger(page) || page < 1) return
    const { offset, limit, totalCount } = tab.table
    const { totalPages } = getPagination(
      offset,
      limit,
      tab.table.countStatus === "success" ? totalCount : null,
    )
    const next = totalPages === null ? page : Math.min(page, totalPages)
    await set(setViewRangeAtom, {
      tabId,
      offset: pageOffset(next, offset, limit),
      limit,
    })
  },
)

export const setViewPageSizeAtom = atom(
  null,
  async (get, set, { tabId, limit }: { tabId: string; limit: number }) => {
    const tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "view" || limit === tab.table.limit) return
    await set(setViewRangeAtom, { tabId, offset: 0, limit })
  },
)

export const setViewSortAtom = atom(
  null,
  async (
    get,
    set,
    {
      tabId,
      sort,
      order,
    }: { tabId: string; sort: ViewTableState["sort"]; order: string[] },
  ) => {
    const tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "view" || tab.closing || tab.table.status === "running")
      return
    const names = new Set(
      tab.table.columns.map((column) => column.sourceColumn ?? column.name),
    )
    if (
      order.length !== tab.table.columns.length ||
      new Set(order).size !== order.length ||
      order.some(
        (id) => !tab.table.columns.some((column) => column.id === id),
      ) ||
      new Set(sort.map((order) => order.column)).size !== sort.length ||
      sort.some((order) => !names.has(order.column))
    )
      return
    if (
      sort.length === tab.table.sort.length &&
      sort.every(
        (order, i) =>
          order.column === tab.table.sort[i].column &&
          order.direction === tab.table.sort[i].direction,
      )
    ) {
      set(tabStatesAtom, (states) =>
        updateViewTable(states, tabId, (current) => ({
          ...current,
          sortOrder: order,
        })),
      )
      return
    }
    await set(loadViewPageAtom, {
      tabId,
      sort,
      sortOrder: order,
      offset: 0,
    })
  },
)

export const cancelViewAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }) => {
    const tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "view" || tab.cancelling) return
    const ids = [
      tab.table.status === "running" ? tab.table.requestId : undefined,
      tab.table.countStatus === "running"
        ? tab.table.countRequestId
        : undefined,
    ].filter((id) => id !== undefined)
    if (!ids.length) return
    set(tabStatesAtom, (states) =>
      updateViewTab(states, tab.id, (current) => ({
        ...current,
        cancelling: true,
      })),
    )
    try {
      await Promise.all(ids.map((id) => connApi.cancel(id)))
    } finally {
      set(tabStatesAtom, (states) =>
        updateViewTab(states, tab.id, (current) => ({
          ...current,
          cancelling: false,
        })),
      )
    }
  },
)

export const reloadViewTabsAtom = atom(null, async (get, set) => {
  const tabs = get(tabOrderAtom).filter(
    (id) => get(tabStatesAtom)[id]?.kind === "view",
  )
  await Promise.all(
    tabs.map((tabId) =>
      Promise.all([
        set(loadViewPageAtom, { tabId }),
        set(loadViewCountAtom, tabId),
      ]),
    ),
  )
})
