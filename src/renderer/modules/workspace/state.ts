import { atom } from "jotai"
import type { Config, QueryResult } from "@/contracts/database"
import connApi, {
  connectionEntriesAtom,
  RequestError,
  sessionEntriesAtom,
} from "@/renderer/modules/database"
import type {
  CodeView,
  EditorView,
  LogView,
  QueryTabEditorState,
  QueryTabState,
  QueryTabTableState,
  TabLogEntry,
  TabLoggerState,
  TabLogStatus,
  TableLayout,
  TabMeta,
  TabState,
  ViewTabState,
  ViewTabTableState,
} from "./types"

let nextTabId = 1
let nextLogId = 1
const openings = new Map<string, Promise<string>>()

const MAX_TAB_LOG_ENTRIES = 300
const DEFAULT_VIEW_PAGE_SIZE = 100
const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type StateAction<T extends object> = T | ((current: T) => T)
type TabStateMap = Record<string, TabState>

export type OpenQueryTabOptions = {
  label?: string
  configId?: string
  initialSql?: string
}

export type OpenViewTabOptions = {
  configId: string
  source: {
    schema: string
    table: string
  }
}

// ====================
// 标签页
// ====================

const tabListAtom = atom<TabMeta[]>([])
const tabStatesAtom = atom<TabStateMap>({})

// ====================
// 活跃标签页
// ====================

const activeIdAtom = atom(null as string | null)

export const activeTabAtom = atom<TabState | null>((get) => {
  const activeTabId = get(activeIdAtom)
  if (!activeTabId) {
    return null
  }

  return get(tabStatesAtom)[activeTabId] ?? null
})

export const activeQueryTabAtom = atom<QueryTabState | null>((get) => {
  const tab = get(activeTabAtom)
  return tab?.kind === "query" ? tab : null
})

export const activeSessionAtom = atom((get) => {
  const tab = get(activeQueryTabAtom)
  return get(sessionEntriesAtom).find((s) => s.id === tab?.sessionId)
})

export const activeResultStaleAtom = atom((get) => {
  const tab = get(activeTabAtom)
  if (!tab?.table.dataAt) return false
  if (tab.kind === "query") {
    const session = get(sessionEntriesAtom).find(
      (s) => s.id === tab.table.sessionId,
    )
    return (
      !session ||
      session.status === "closed" ||
      session.status === "failed" ||
      session.id !== tab.sessionId
    )
  }
  const connection = get(connectionEntriesAtom)?.find(
    (c) => c.config.id === tab.configId,
  )
  return (
    !connection?.connected || connection.generation !== tab.table.generation
  )
})

export const activeViewTabAtom = atom<ViewTabState | null>((get) => {
  const tab = get(activeTabAtom)
  return tab?.kind === "view" ? tab : null
})

export const hasActiveTabAtom = atom((get) => get(activeTabAtom) !== null)

// 连接配置
export const activeQueryTabConfigAtom = atom<Config | undefined>((get) => {
  const tab = get(activeQueryTabAtom)
  if (!tab?.configId) {
    return undefined
  }

  return get(connectionEntriesAtom)?.find(
    (connection) => connection.config.id === tab.configId,
  )?.config
})

// ====================
// actions
// ====================

export const openQueryTabAtom = atom(
  null,
  (_get, set, opts?: OpenQueryTabOptions) => {
    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "query",
      configId: opts?.configId,
      table: createDefaultQueryTableState(),
      editor: createDefaultQueryEditorState(opts?.initialSql),
      logger: createDefaultLoggerState(),
    } satisfies QueryTabState

    set(tabListAtom, (tabs) => [
      ...tabs,
      {
        id,
        kind: "query",
        label: opts?.label ?? `查询 ${id}`,
      },
    ])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeIdAtom, id)
    return id
  },
)

export const openViewTabAtom = atom(
  null,
  async (get, set, opts: OpenViewTabOptions) => {
    const existing = Object.values(get(tabStatesAtom)).find(
      (tab): tab is ViewTabState =>
        tab.kind === "view" &&
        tab.configId === opts.configId &&
        tab.source.schema === opts.source.schema &&
        tab.source.table === opts.source.table,
    )
    if (existing) {
      set(activeIdAtom, existing.id)
      return existing.id
    }

    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "view",
      configId: opts.configId,
      source: { ...opts.source },
      table: createDefaultViewTableState(),
      code: createDefaultCodeView(),
      logger: createDefaultLoggerState(),
    } satisfies ViewTabState

    set(tabListAtom, (tabs) => [
      ...tabs,
      { id, kind: "view", label: opts.source.table },
    ])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeIdAtom, id)

    await Promise.all([
      set(loadViewTabPageByIdAtom, id),
      set(loadViewTabCountByIdAtom, id),
    ])
    return id
  },
)

export const closeTabAtom = atom(null, async (get, set, tabId: string) => {
  const current = get(tabStatesAtom)[tabId]
  if (!current || current.closing) return
  set(tabStatesAtom, (states) => ({
    ...states,
    [tabId]: { ...states[tabId], closing: true },
  }))
  try {
    await openings.get(tabId)?.catch(() => {})
    if (!(await connApi.closeTab(tabId))) return
    const tabs = get(tabListAtom)
    const activeTabId = get(activeIdAtom)
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId)
    if (closedIndex === -1) {
      return
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextActiveTabId =
      activeTabId !== null && activeTabId !== tabId
        ? activeTabId
        : nextTabs.length === 0
          ? null
          : nextTabs[Math.max(0, closedIndex - 1)].id

    set(tabListAtom, nextTabs)
    set(activeIdAtom, nextActiveTabId)
    set(tabStatesAtom, (states) => deleteTabState(states, tabId))
  } finally {
    set(tabStatesAtom, (states) =>
      states[tabId]
        ? { ...states, [tabId]: { ...states[tabId], closing: false } }
        : states,
    )
  }
})

export const resetActiveQueryTabTableStateAtom = atom(null, (get, set) => {
  const tabId = getActiveQueryTab(get).id
  set(updateQueryLayoutAtom, {
    tabId,
    update: (current) => ({
      ...current,
      sorting: [],
      visibility: {},
      sizing: {},
      pinning: {
        start: [],
        end: [],
      },
      selected: null,
    }),
  })
})

export const resetActiveViewTabTableStateAtom = atom(null, (get, set) => {
  const tabId = getActiveViewTab(get).id
  set(updateViewLayoutAtom, {
    tabId,
    update: (current) => ({
      ...current,
      visibility: {},
      sizing: {},
      pinning: {
        start: [],
        end: [],
      },
      selected: null,
    }),
  })
})

const loadViewTabPageByIdAtom = atom(null, async (get, set, tabId: string) => {
  const tab = get(tabStatesAtom)[tabId]
  if (
    !tab ||
    tab.closing ||
    tab.kind !== "view" ||
    tab.table.status === "running"
  ) {
    return
  }

  const requestId = crypto.randomUUID()
  const generation = get(connectionEntriesAtom)?.find(
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
    updateViewTabTableState(states, tabId, (current) => ({
      ...current,
      requestId: requestId,
      status: "running",
      error: null,
    })),
  )
  set(tabStatesAtom, (states) =>
    updateTabLoggerState(states, tabId, (current) => ({
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
        limit: tab.table.pageSize,
        offset: tab.table.pageIndex * tab.table.pageSize,
      },
    )
    if (!isCurrent()) return
    const finishedAt = Date.now()
    const durationMs = Math.max(1, finishedAt - startedAt)

    set(tabStatesAtom, (states) =>
      updateViewTabTableState(states, tabId, (current) => ({
        ...current,
        status: "success",
        error: null,
        dataAt: finishedAt,
        generation,
        sql: executedSql,
        columns: result.columns,
        data: toTableRows(result),
        selected: null,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
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
      updateViewTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: message,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
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

const loadViewTabCountByIdAtom = atom(null, async (get, set, tabId: string) => {
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
    updateViewTabTableState(states, tabId, (current) => ({
      ...current,
      countRequestId: requestId,
      countStatus: "running",
      countError: null,
    })),
  )
  set(tabStatesAtom, (states) =>
    updateTabLoggerState(states, tabId, (current) => ({
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
      updateViewTabTableState(states, tabId, (current) => ({
        ...current,
        totalCount,
        countStatus: "success",
        countError: null,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
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
      updateViewTabTableState(states, tabId, (current) => ({
        ...current,
        totalCount: null,
        countStatus: "error",
        countError: message,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
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

export const refreshActiveViewTabAtom = atom(null, async (get, set) => {
  const tab = get(activeViewTabAtom)
  if (!tab) {
    return
  }
  await Promise.all([
    set(loadViewTabPageByIdAtom, tab.id),
    set(loadViewTabCountByIdAtom, tab.id),
  ])
})

export const setActiveViewTabPageAtom = atom(
  null,
  async (get, set, pageIndex: number) => {
    const tab = get(activeViewTabAtom)
    if (!tab || tab.table.status === "running") {
      return
    }

    const maxPageIndex =
      tab.table.totalCount === null
        ? pageIndex
        : Math.max(0, Math.ceil(tab.table.totalCount / tab.table.pageSize) - 1)
    const nextPageIndex = Math.min(Math.max(0, pageIndex), maxPageIndex)
    if (nextPageIndex === tab.table.pageIndex) {
      return
    }

    set(tabStatesAtom, (states) =>
      updateViewTabTableState(states, tab.id, (current) => ({
        ...current,
        pageIndex: nextPageIndex,
      })),
    )
    await set(loadViewTabPageByIdAtom, tab.id)
  },
)

export const setActiveViewTabPageSizeAtom = atom(
  null,
  async (get, set, pageSize: number) => {
    const tab = get(activeViewTabAtom)
    if (
      !tab ||
      tab.table.status === "running" ||
      !Number.isInteger(pageSize) ||
      pageSize <= 0 ||
      pageSize === tab.table.pageSize
    ) {
      return
    }

    set(tabStatesAtom, (states) =>
      updateViewTabTableState(states, tab.id, (current) => ({
        ...current,
        pageIndex: 0,
        pageSize,
      })),
    )
    await set(loadViewTabPageByIdAtom, tab.id)
  },
)

// 内部 action atom，复用同一套 SQL 执行流程。
const runQueryTabSqlByIdAtom = atom(null, async (get, set, tabId: string) => {
  const tab = get(tabStatesAtom)[tabId]
  if (!tab || tab.closing || tab.kind !== "query") {
    return
  }

  const editor = tab.editor
  if (editor.status === "running") return
  const sql = editor.text
  const trimmedSql = sql.trim()

  if (!trimmedSql) {
    const finishedAt = Date.now()

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: "SQL 不能为空",
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
        ...current,
        logs: trimLogs([
          ...current.logs,
          createLogEntry("error", sql, "SQL 不能为空", {
            detail: "请输入要执行的 SQL 语句",
            finishedAt,
          }),
        ]),
      })),
    )
    return
  }

  if (!tab.configId) {
    const finishedAt = Date.now()

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: "该标签页未绑定数据库连接",
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
        ...current,
        logs: trimLogs([
          ...current.logs,
          createLogEntry("error", sql, "该标签页未绑定数据库连接", {
            detail: "请先为当前标签页选择数据库连接",
            finishedAt,
          }),
        ]),
      })),
    )
    return
  }

  const requestId = crypto.randomUUID()
  let sessionId = tab.sessionId
  const isCurrent = () => {
    const current = get(tabStatesAtom)[tabId]
    return (
      current?.kind === "query" &&
      current.requestId === requestId &&
      (!sessionId || current.sessionId === sessionId)
    )
  }
  set(tabStatesAtom, (states) => ({
    ...states,
    [tabId]: {
      ...tab,
      requestId,
      phase: sessionId ? "running" : "connecting",
      cancelRequested: false,
    },
  }))
  const startedAt = Date.now()
  const runningLog = createLogEntry("running", sql, "正在执行 SQL", {
    detail: "正在等待数据库返回结果",
    startedAt,
  })
  const recordLate = (status: TabLogStatus, summary: string) => {
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
        ...current,
        logs: current.logs.map((entry) =>
          entry.id === runningLog.id
            ? {
                ...entry,
                status,
                summary,
                detail: "来自此前会话，未更新当前结果",
                finishedAt: Date.now(),
                durationMs: Math.max(1, Date.now() - startedAt),
              }
            : entry,
        ),
      })),
    )
  }

  set(tabStatesAtom, (states) =>
    updateQueryTabTableState(states, tabId, (current) => ({
      ...current,
      status: "running",
      error: null,
    })),
  )
  set(tabStatesAtom, (states) =>
    updateQueryTabEditorState(states, tabId, (current) => ({
      ...current,
      status: "running",
    })),
  )
  set(tabStatesAtom, (states) =>
    updateTabLoggerState(states, tabId, (current) => ({
      ...current,
      logs: trimLogs([...current.logs, runningLog]),
    })),
  )

  try {
    if (!sessionId) {
      const opening = connApi.openSession(tab.configId, tabId)
      openings.set(tabId, opening)
      try {
        sessionId = await opening
      } finally {
        openings.delete(tabId)
      }
      set(tabStatesAtom, (states) => {
        const current = states[tabId]
        return current?.kind === "query" && current.requestId === requestId
          ? { ...states, [tabId]: { ...current, sessionId } }
          : states
      })
    }
    const current = get(tabStatesAtom)[tabId]
    if (
      !isCurrent() ||
      current.closing ||
      (current.kind === "query" && current.cancelRequested)
    )
      throw new RequestError("请求已取消，未执行 SQL", "cancelled")
    const session = get(sessionEntriesAtom).find((s) => s.id === sessionId)
    if (!session || session.status === "closed" || session.status === "failed")
      throw new Error(
        "会话已失效，请重建会话；原事务、临时表及会话设置不会恢复",
      )
    set(tabStatesAtom, (states) => ({
      ...states,
      [tabId]: {
        ...(states[tabId] as QueryTabState),
        phase: session.status === "idle" ? "connecting" : "running",
      },
    }))
    const result = await connApi.query(sessionId, requestId, sql)
    if (!isCurrent()) {
      recordLate(
        "success",
        `原会话返回 ${result.rowCount ?? result.rows.length} 行`,
      )
      return
    }
    const rowCount =
      typeof result.rowCount === "number" ? result.rowCount : result.rows.length
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, {
        ...createDefaultQueryTableState(),
        status: "success",
        error: null,
        dataAt: finishedAt,
        sessionId,
        columns: result.columns,
        data: toTableRows(result),
      }),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabEditorState(states, tabId, (current) => ({
        ...current,
        status: "idle",
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
        ...current,
        logs: trimLogs(
          upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
            ...(currentLog ?? runningLog),
            status: "success",
            summary: `返回 ${rowCount} 行`,
            detail: undefined,
            finishedAt,
            durationMs,
          })),
        ),
      })),
    )
  } catch (error) {
    if (!isCurrent()) {
      recordLate(
        error instanceof RequestError ? error.kind : "error",
        error instanceof Error ? error.message : "原会话执行失败",
      )
      return
    }
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : "查询执行失败"

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: message,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabEditorState(states, tabId, (current) => ({
        ...current,
        status: "idle",
      })),
    )
    set(tabStatesAtom, (states) =>
      updateTabLoggerState(states, tabId, (current) => ({
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
  } finally {
    if (isCurrent())
      set(tabStatesAtom, (states) => ({
        ...states,
        [tabId]: {
          ...(states[tabId] as QueryTabState),
          requestId: undefined,
          phase: undefined,
          cancelRequested: false,
        },
      }))
  }
})

export const runActiveQueryTabSqlAtom = atom(null, async (get, set) => {
  const tab = get(activeQueryTabAtom)
  if (!tab) {
    return
  }

  await set(runQueryTabSqlByIdAtom, tab.id)
})

export const cancelActiveQueryAtom = atom(null, async (get, set) => {
  const tab = get(activeQueryTabAtom)
  if (!tab?.requestId || tab.closing) return
  const requestId = tab.requestId
  set(tabStatesAtom, (states) => ({
    ...states,
    [tab.id]: { ...tab, cancelRequested: true, phase: "cancelling" },
  }))
  try {
    await connApi.cancel(requestId)
  } catch (error) {
    set(tabStatesAtom, (states) => {
      const current = states[tab.id]
      return current?.kind === "query" && current.requestId === requestId
        ? { ...states, [tab.id]: { ...current, phase: "running" } }
        : states
    })
    throw error
  }
})

export const bindQueryConfigAtom = atom(
  null,
  async (
    get,
    set,
    { tabId, configId }: { tabId: string; configId?: string },
  ) => {
    const tab = get(tabStatesAtom)[tabId]
    if (
      tab?.kind !== "query" ||
      tab.closing ||
      tab.editor.status === "running" ||
      tab.configId === configId
    )
      return

    const exists = () =>
      !configId ||
      get(connectionEntriesAtom)?.some((entry) => entry.config.id === configId)
    if (!exists()) throw new Error("连接配置不存在或已删除")

    set(tabStatesAtom, (states) =>
      updateQueryTabState(states, tabId, (current) => ({
        ...current,
        closing: true,
      })),
    )
    try {
      if (tab.sessionId && !(await connApi.closeTab(tabId))) return
      if (!exists()) throw new Error("连接配置不存在或已删除")
      set(tabStatesAtom, (states) =>
        updateQueryTabState(states, tabId, (current) => ({
          ...current,
          configId,
          sessionId: undefined,
          requestId: undefined,
          phase: undefined,
          cancelRequested: false,
        })),
      )
    } finally {
      set(tabStatesAtom, (states) =>
        updateQueryTabState(states, tabId, (current) => ({
          ...current,
          closing: false,
        })),
      )
    }
  },
)

export const rebuildActiveSessionAtom = atom(null, async (get, set) => {
  const tab = get(activeQueryTabAtom)
  if (!tab?.configId || tab.closing) return
  set(tabStatesAtom, (states) => ({
    ...states,
    [tab.id]: { ...tab, closing: true },
  }))
  try {
    await openings.get(tab.id)?.catch(() => {})
    // closeTab also handles a session whose open response has not yet reached the tab.
    if (!(await connApi.closeTab(tab.id))) return
    const sessionId = await connApi.openSession(tab.configId, tab.id)
    set(tabStatesAtom, (states) => {
      const current = states[tab.id]
      if (current?.kind !== "query") return states
      return {
        ...states,
        [tab.id]: {
          ...current,
          sessionId,
          requestId: undefined,
          phase: undefined,
          cancelRequested: false,
          editor: { ...current.editor, status: "idle" },
          table: {
            ...current.table,
            status: current.table.dataAt ? "success" : "idle",
          },
        },
      }
    })
  } finally {
    set(tabStatesAtom, (states) =>
      states[tab.id]
        ? { ...states, [tab.id]: { ...states[tab.id], closing: false } }
        : states,
    )
  }
})

export const cancelActiveViewAtom = atom(null, async (get) => {
  const tab = get(activeViewTabAtom)
  if (!tab) return
  const ids = [
    tab.table.status === "running" ? tab.table.requestId : undefined,
    tab.table.countStatus === "running" ? tab.table.countRequestId : undefined,
  ].filter((id) => id !== undefined)
  await Promise.all(ids.map((id) => connApi.cancel(id)))
})

// helper

function getActiveTab(
  get: (atom: typeof activeTabAtom) => TabState | null,
): TabState {
  const tab = get(activeTabAtom)
  if (!tab) {
    throw new Error("当前没有活动标签页")
  }
  return tab
}

function getActiveQueryTab(
  get: (atom: typeof activeTabAtom) => TabState | null,
): QueryTabState {
  const tab = getActiveTab(get)
  if (tab.kind !== "query") {
    throw new Error("当前活动标签页不是查询标签页")
  }

  return tab
}

function getActiveViewTab(
  get: (atom: typeof activeTabAtom) => TabState | null,
): ViewTabState {
  const tab = getActiveTab(get)
  if (tab.kind !== "view") {
    throw new Error("当前活动标签页不是数据浏览标签页")
  }

  return tab
}

function applyStateAction<T extends object>(
  current: T,
  action: StateAction<T>,
): T {
  return typeof action === "function" ? action(current) : action
}

function updateQueryTabState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<QueryTabState>,
): TabStateMap {
  const current = states[tabId]
  if (current?.kind !== "query") {
    return states
  }

  const next = applyStateAction(current, action)
  return Object.is(next, current) ? states : { ...states, [tabId]: next }
}

function updateViewTabState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<ViewTabState>,
): TabStateMap {
  const current = states[tabId]
  if (current?.kind !== "view") {
    return states
  }

  const next = applyStateAction(current, action)
  return Object.is(next, current) ? states : { ...states, [tabId]: next }
}

function updateQueryTabTableState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<QueryTabTableState>,
): TabStateMap {
  return updateQueryTabState(states, tabId, (current) => {
    const table = applyStateAction(current.table, action)
    return Object.is(table, current.table) ? current : { ...current, table }
  })
}

function updateQueryTabEditorState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<QueryTabEditorState>,
): TabStateMap {
  return updateQueryTabState(states, tabId, (current) => {
    const editor = applyStateAction(current.editor, action)
    return Object.is(editor, current.editor) ? current : { ...current, editor }
  })
}

function updateViewTabTableState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<ViewTabTableState>,
): TabStateMap {
  return updateViewTabState(states, tabId, (current) => {
    const table = applyStateAction(current.table, action)
    return Object.is(table, current.table) ? current : { ...current, table }
  })
}

function updateTabLoggerState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<TabLoggerState>,
): TabStateMap {
  const current = states[tabId]
  if (!current) {
    return states
  }

  const logger = applyStateAction(current.logger, action)
  if (Object.is(logger, current.logger)) {
    return states
  }
  return {
    ...states,
    [tabId]: {
      ...current,
      logger,
    },
  }
}

function toTableRows(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    return result.columns.reduce(
      (record, column, index) => {
        record[column.id] = row[index]
        return record
      },
      {} as Record<string, unknown>,
    )
  })
}

function toTotalCount(value: unknown): number {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(count) || count < 0) {
    throw new Error("无法读取数据表总行数")
  }

  return Math.trunc(count)
}

function createDefaultViewTableState(): ViewTabTableState {
  return {
    status: "idle",
    error: null,
    dataAt: null,
    sql: "",
    data: [],
    columns: [],
    visibility: {},
    sizing: {},
    pinning: {
      start: [],
      end: [],
    },
    selected: null,
    pageIndex: 0,
    pageSize: DEFAULT_VIEW_PAGE_SIZE,
    totalCount: null,
    countStatus: "idle",
    countError: null,
  }
}

function deleteTabState(states: TabStateMap, tabId: string): TabStateMap {
  if (!(tabId in states)) {
    return states
  }

  const { [tabId]: _deleted, ...nextStates } = states
  return nextStates
}

function createDefaultQueryTableState(): QueryTabTableState {
  return {
    status: "idle",
    dataAt: null,
    error: null,
    data: [],
    columns: [],
    sorting: [],
    visibility: {},
    sizing: {},
    pinning: {
      start: [],
      end: [],
    },
    selected: null,
  }
}

function createDefaultQueryEditorState(text = ""): QueryTabEditorState {
  return {
    ...createDefaultCodeView(),
    status: "idle",
    text,
  }
}

function createDefaultCodeView(): CodeView {
  return {
    cursor: { ...DEFAULT_CURSOR },
    selections: [{ anchor: 0, head: 0 }],
    mainSelectionIndex: 0,
    scroll: { top: 0, left: 0 },
    search: {
      query: "",
      replace: "",
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      open: false,
    },
  }
}

function createDefaultLoggerState(): TabLoggerState {
  return {
    query: "",
    statuses: [],
    followTail: true,
    logs: [],
  }
}

function trimLogs(entries: TabLogEntry[]): TabLogEntry[] {
  return entries.length <= MAX_TAB_LOG_ENTRIES
    ? entries
    : entries.slice(entries.length - MAX_TAB_LOG_ENTRIES)
}

function createLogEntry(
  status: TabLogStatus,
  sql: string,
  summary: string,
  options?: {
    detail?: string
    startedAt?: number
    finishedAt?: number
    durationMs?: number
  },
): TabLogEntry {
  return {
    id: String(nextLogId++),
    status,
    sql,
    summary,
    detail: options?.detail,
    startedAt: options?.startedAt ?? Date.now(),
    finishedAt: options?.finishedAt,
    durationMs: options?.durationMs,
  }
}

function upsertLogEntry(
  entries: TabLogEntry[],
  entryId: string,
  getNextEntry: (current?: TabLogEntry) => TabLogEntry,
): TabLogEntry[] {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index === -1) {
    return [...entries, getNextEntry()]
  }

  const nextEntries = [...entries]
  nextEntries[index] = getNextEntry(nextEntries[index])
  return nextEntries
}

export const tabsAtom = atom((get) => get(tabListAtom))
export const activeTabIdAtom = atom((get) => get(activeIdAtom))
export const selectTabAtom = atom(null, (get, set, id: string) => {
  if (get(tabStatesAtom)[id]) set(activeIdAtom, id)
})

export const activeQueryTabTableStateAtom = atom(
  (get) => getActiveQueryTab(get).table,
)
export const updateQueryLayoutAtom = atom(
  null,
  (
    _get,
    set,
    {
      tabId,
      update,
    }: {
      tabId: string
      update: (current: TableLayout) => TableLayout
    },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (tab?.kind !== "query") return states
      const next = update(tab.table)
      if (next === tab.table) return states
      const { visibility, sizing, sorting, pinning, selected } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          table: {
            ...tab.table,
            visibility,
            sizing,
            sorting: sorting ?? tab.table.sorting,
            pinning,
            selected,
          },
        },
      }
    })
  },
)

export const activeViewTabTableStateAtom = atom(
  (get) => getActiveViewTab(get).table,
)
export const updateViewLayoutAtom = atom(
  null,
  (
    _get,
    set,
    {
      tabId,
      update,
    }: {
      tabId: string
      update: (current: TableLayout) => TableLayout
    },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (tab?.kind !== "view") return states
      const next = update(tab.table)
      if (next === tab.table) return states
      const { visibility, sizing, pinning, selected } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          table: { ...tab.table, visibility, sizing, pinning, selected },
        },
      }
    })
  },
)

export const activeQueryTabEditorStateAtom = atom(
  (get) => getActiveQueryTab(get).editor,
)
export const updateQueryEditorAtom = atom(
  null,
  (
    _get,
    set,
    {
      tabId,
      update,
    }: {
      tabId: string
      update: (current: EditorView) => EditorView
    },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (tab?.kind !== "query") return states
      const next = update(tab.editor)
      if (next === tab.editor) return states
      const { text, cursor, selections, mainSelectionIndex, scroll, search } =
        next
      return {
        ...states,
        [tabId]: {
          ...tab,
          editor: {
            ...tab.editor,
            text,
            cursor,
            selections,
            mainSelectionIndex,
            scroll,
            search,
          },
        },
      }
    })
  },
)

export const updateViewCodeAtom = atom(
  null,
  (_get, set, { tabId, view }: { tabId: string; view: CodeView }) => {
    set(tabStatesAtom, (states) =>
      updateViewTabState(states, tabId, (current) => {
        const { cursor, selections, mainSelectionIndex, scroll, search } = view
        return {
          ...current,
          code: { cursor, selections, mainSelectionIndex, scroll, search },
        }
      }),
    )
  },
)

export const activeTabLoggerAtom = atom((get) => getActiveTab(get).logger)
export const updateLogViewAtom = atom(
  null,
  (
    _get,
    set,
    { tabId, update }: { tabId: string; update: (current: LogView) => LogView },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (!tab) return states
      const next = update(tab.logger)
      if (next === tab.logger) return states
      const { query, statuses, followTail } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          logger: { ...tab.logger, query, statuses, followTail },
        },
      }
    })
  },
)

export const clearLogsAtom = atom(null, (_get, set, tabId: string) => {
  set(tabStatesAtom, (states) =>
    updateTabLoggerState(states, tabId, (current) => ({
      ...current,
      logs: [],
    })),
  )
})
