import { atom } from "jotai"
import type { Config, QueryResult } from "@/lib/conn"
import connApi, { connectionEntriesAtom } from "@/lib/conn/renderer"
import type {
  QueryTabEditorState,
  QueryTabState,
  QueryTabTableState,
  TabLogEntry,
  TabLoggerState,
  TabLogStatus,
  TabMeta,
  TabState,
  ViewTabState,
  ViewTabTableState,
} from "./index"

let nextTabId = 1
let nextLogId = 1

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

export const tabsAtom = atom<TabMeta[]>([])
const tabStatesAtom = atom<TabStateMap>({})

// ====================
// 活跃标签页
// ====================

export const activeTabIdAtom = atom(null as string | null)

export const activeTabAtom = atom<TabState | null>((get) => {
  const activeTabId = get(activeTabIdAtom)
  if (!activeTabId) {
    return null
  }

  return get(tabStatesAtom)[activeTabId] ?? null
})

export const activeQueryTabAtom = atom<QueryTabState | null>((get) => {
  const tab = get(activeTabAtom)
  return tab?.kind === "query" ? tab : null
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

// 表格 ui 状态
export const activeQueryTabTableStateAtom = atom(
  (get) => getActiveQueryTab(get).table,
  (get, set, action: StateAction<QueryTabTableState>) => {
    const tabId = getActiveQueryTab(get).id
    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, action),
    )
  },
)

// 编辑器 ui 状态
export const activeQueryTabEditorStateAtom = atom(
  (get) => getActiveQueryTab(get).editor,
  (get, set, action: StateAction<QueryTabEditorState>) => {
    const tabId = getActiveQueryTab(get).id
    set(tabStatesAtom, (states) =>
      updateQueryTabEditorState(states, tabId, action),
    )
  },
)

// 日志 ui 状态
export const activeTabLoggerAtom = atom(
  (get) => getActiveTab(get).logger,
  (get, set, action: StateAction<TabLoggerState>) => {
    const tabId = getActiveTab(get).id
    set(tabStatesAtom, (states) => updateTabLoggerState(states, tabId, action))
  },
)

export const activeViewTabTableStateAtom = atom(
  (get) => getActiveViewTab(get).table,
  (get, set, action: StateAction<ViewTabTableState>) => {
    const tabId = getActiveViewTab(get).id
    set(tabStatesAtom, (states) =>
      updateViewTabTableState(states, tabId, action),
    )
  },
)

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

    set(tabsAtom, (tabs) => [
      ...tabs,
      {
        id,
        kind: "query",
        label: opts?.label ?? `查询 ${id}`,
      },
    ])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeTabIdAtom, id)
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
      set(activeTabIdAtom, existing.id)
      return existing.id
    }

    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "view",
      configId: opts.configId,
      source: { ...opts.source },
      table: createDefaultViewTableState(),
      logger: createDefaultLoggerState(),
    } satisfies ViewTabState

    set(tabsAtom, (tabs) => [
      ...tabs,
      { id, kind: "view", label: opts.source.table },
    ])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeTabIdAtom, id)

    await Promise.all([
      set(loadViewTabPageByIdAtom, id),
      set(loadViewTabCountByIdAtom, id),
    ])
    return id
  },
)

export const closeTabAtom = atom(null, (get, set, tabId: string) => {
  const tabs = get(tabsAtom)
  const activeTabId = get(activeTabIdAtom)
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

  set(tabsAtom, nextTabs)
  set(activeTabIdAtom, nextActiveTabId)
  set(tabStatesAtom, (states) => deleteTabState(states, tabId))
})

export const resetActiveQueryTabTableStateAtom = atom(null, (_get, set) => {
  set(activeQueryTabTableStateAtom, (current) => ({
    ...current,
    sorting: [],
    visibility: {},
    sizing: {},
    pinning: {
      left: [],
      right: [],
    },
    selected: null,
  }))
})

export const resetActiveViewTabTableStateAtom = atom(null, (_get, set) => {
  set(activeViewTabTableStateAtom, (current) => ({
    ...current,
    visibility: {},
    sizing: {},
    pinning: {
      left: [],
      right: [],
    },
    selected: null,
  }))
})

const loadViewTabPageByIdAtom = atom(null, async (get, set, tabId: string) => {
  const tab = get(tabStatesAtom)[tabId]
  if (!tab || tab.kind !== "view" || tab.table.status === "running") {
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", "", "正在加载数据表", {
    detail: `${tab.source.schema}.${tab.source.table}`,
    startedAt,
  })

  set(tabStatesAtom, (states) =>
    updateViewTabTableState(states, tabId, (current) => ({
      ...current,
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
    const { result, executedSql } = await connApi.select(tab.configId, {
      from: tab.source,
      limit: tab.table.pageSize,
      offset: tab.table.pageIndex * tab.table.pageSize,
    })
    const finishedAt = Date.now()
    const durationMs = Math.max(1, finishedAt - startedAt)

    set(tabStatesAtom, (states) =>
      updateViewTabTableState(states, tabId, (current) => ({
        ...current,
        status: "success",
        error: null,
        dataAt: finishedAt,
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
            status: "error",
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
  if (!tab || tab.kind !== "view" || tab.table.countStatus === "running") {
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", "", "正在统计数据表行数", {
    detail: `${tab.source.schema}.${tab.source.table}`,
    startedAt,
  })

  set(tabStatesAtom, (states) =>
    updateViewTabTableState(states, tabId, (current) => ({
      ...current,
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
    const { result, executedSql } = await connApi.select(tab.configId, {
      from: tab.source,
      select: [{ aggregate: "count", alias: "total" }],
    })
    const totalCount = toTotalCount(result.rows[0]?.[0])
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
            status: "error",
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
  if (!tab || tab.kind !== "query") {
    return
  }

  const editor = tab.editor
  const sql = editor.text
  const trimmedSql = sql.trim()

  if (!trimmedSql) {
    const finishedAt = Date.now()

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: "SQL 不能为空",
        dataAt: finishedAt,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabLoggerState(states, tabId, (current) => ({
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
        dataAt: finishedAt,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabLoggerState(states, tabId, (current) => ({
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

  if (editor.status === "running") {
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", sql, "正在执行 SQL", {
    detail: "正在等待数据库返回结果",
    startedAt,
  })

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
    updateQueryTabLoggerState(states, tabId, (current) => ({
      ...current,
      logs: trimLogs([...current.logs, runningLog]),
    })),
  )

  try {
    const connection = await connApi.get(tab.configId)
    if (!connection) {
      throw new Error("活动标签页绑定的数据库连接不存在")
    }

    if (!connection.connected) {
      throw new Error("连接尚未建立，请先连接数据库")
    }

    const result = await connApi.query(tab.configId, sql)
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
      updateQueryTabLoggerState(states, tabId, (current) => ({
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
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : "查询执行失败"

    set(tabStatesAtom, (states) =>
      updateQueryTabTableState(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: message,
        dataAt: finishedAt,
      })),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabEditorState(states, tabId, (current) => ({
        ...current,
        status: "idle",
      })),
    )
    set(tabStatesAtom, (states) =>
      updateQueryTabLoggerState(states, tabId, (current) => ({
        ...current,
        logs: trimLogs(
          upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
            ...(currentLog ?? runningLog),
            status: "error",
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

export const runActiveQueryTabSqlAtom = atom(null, async (get, set) => {
  const tab = get(activeQueryTabAtom)
  if (!tab) {
    return
  }

  await set(runQueryTabSqlByIdAtom, tab.id)
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
  if (!current || current.kind !== "query") {
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
  if (!current || current.kind !== "view") {
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

function updateQueryTabLoggerState(
  states: TabStateMap,
  tabId: string,
  action: StateAction<TabLoggerState>,
): TabStateMap {
  return updateTabLoggerState(states, tabId, action)
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
    data: [],
    columns: [],
    visibility: {},
    sizing: {},
    pinning: {
      left: [],
      right: [],
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
      left: [],
      right: [],
    },
    selected: null,
  }
}

function createDefaultQueryEditorState(text = ""): QueryTabEditorState {
  return {
    status: "idle",
    text,
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
