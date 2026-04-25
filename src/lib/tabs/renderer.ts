import { atom } from "jotai"
import type { Getter, Setter } from "jotai/vanilla"
import type { Config } from "@/lib/config"
import type { QueryResult } from "@/lib/conn"
import connApi from "@/lib/conn/renderer"
import type {
  TabEditorState,
  TabLogEntry,
  TabLogStatus,
  TabLogViewState,
  TabResultState,
  TabTableState,
} from "./index"

let nextTabId = 1
let nextLogId = 1

const MAX_TAB_LOG_ENTRIES = 300
const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type StateUpdater<T extends object> = Partial<T> | ((current: T) => T)

// 标签页

type TabState = {
  id: string
  label: string
  connection?: Config
  sql: string
  editor: TabEditorState
  result: TabResultState
  table: TabTableState
  logEntries: TabLogEntry[]
  logView: TabLogViewState
}
const _tabsAtom = atom<TabState[]>([])

export const tabsAtom = atom((get) => get(_tabsAtom))
export const hasTabsAtom = atom((get) => get(_tabsAtom).length > 0)

// 活跃标签页

export const activeTabIdAtom = atom(null as string | null)
const activeTabAtom = atom<TabState | null>((get) => {
  const activeTabId = get(activeTabIdAtom)
  if (!activeTabId) {
    return null
  }

  return get(_tabsAtom).find((tab) => tab.id === activeTabId) ?? null
})

// 活跃标签页的派生字段

export const activeTabSqlAtom = atom(
  (get) => get(activeTabAtom)?.sql ?? "",
  (get, set, updater: string | ((current: string) => string)) => {
    updateActiveTab(get, set, (tab) => ({
      ...tab,
      sql: typeof updater === "function" ? updater(tab.sql) : updater,
    }))
  },
)

export const activeTabEditorStateAtom = atom(
  (get) => get(activeTabAtom)?.editor ?? null,
  (get, set, updater: StateUpdater<TabEditorState>) => {
    updateActiveTab(get, set, (tab) => ({
      ...tab,
      editor: applyStateUpdater(tab.editor, updater),
    }))
  },
)

export const activeTabConnectionAtom = atom<Config | undefined>((get) => {
  return get(activeTabAtom)?.connection
})

export const activeTabResultAtom = atom<TabResultState | null>((get) => {
  return get(activeTabAtom)?.result ?? null
})

export const activeTabLogEntriesAtom = atom(
  (get) => get(activeTabAtom)?.logEntries ?? [],
  (
    get,
    set,
    updater: TabLogEntry[] | ((current: TabLogEntry[]) => TabLogEntry[]),
  ) => {
    updateActiveTab(get, set, (tab) => ({
      ...tab,
      logEntries: trimLogs(
        typeof updater === "function" ? updater(tab.logEntries) : updater,
      ),
    }))
  },
)

export const activeTabLogViewAtom = atom(
  (get) => get(activeTabAtom)?.logView ?? null,
  (get, set, updater: StateUpdater<TabLogViewState>) => {
    updateActiveTab(get, set, (tab) => ({
      ...tab,
      logView: applyStateUpdater(tab.logView, updater),
    }))
  },
)

export const activeTabTableStateAtom = atom(
  (get) => get(activeTabAtom)?.table ?? null,
  (get, set, updater: StateUpdater<TabTableState>) => {
    updateActiveTab(get, set, (tab) => ({
      ...tab,
      table: applyStateUpdater(tab.table, updater),
    }))
  },
)

// 动作 atoms

export const createTabAtom = atom(
  false,
  async (
    get,
    set,
    options?: {
      label?: string
      sql?: string
      connection?: Config
      autoRun?: boolean
    },
  ) => {
    const tab = createTabState(options)
    tab.label = options?.label ?? `查询 ${tab.id}`

    set(_tabsAtom, [...get(_tabsAtom), tab])
    set(activeTabIdAtom, tab.id)

    if (options?.autoRun && tab.sql) {
      await runTabSql(get, set, tab.id)
    }
  },
)

export const closeTabAtom = atom(false, (get, set, tabId: string) => {
  const tabs = get(_tabsAtom)
  const nextTabs = tabs.filter((tab) => tab.id !== tabId)

  if (get(activeTabIdAtom) === tabId) {
    if (nextTabs.length === 0) {
      set(activeTabIdAtom, null)
    } else {
      const closedIndex = tabs.findIndex((tab) => tab.id === tabId)
      set(activeTabIdAtom, nextTabs[Math.max(0, closedIndex - 1)].id)
    }
  }

  set(_tabsAtom, nextTabs)
})

export const resetActiveTabTableStateAtom = atom(false, (get, set) => {
  updateActiveTab(get, set, (tab) => ({
    ...tab,
    table: createDefaultTableState(),
  }))
})

export const runActiveTabSqlAtom = atom(false, async (get, set) => {
  const activeTabId = get(activeTabIdAtom)
  if (!activeTabId) {
    return
  }

  await runTabSql(get, set, activeTabId)
})

// helper

function createDefaultResultState(): TabResultState {
  return {
    status: "idle",
    lastRunSql: "",
    lastRunAt: null,
    durationMs: null,
    columns: [],
    rows: [],
    rowCount: 0,
    error: null,
  }
}

function createDefaultEditorState(): TabEditorState {
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

function createDefaultTableState(): TabTableState {
  return {
    sorting: [],
    columnVisibility: {},
    columnSizing: {},
    columnPinning: {
      left: [],
      right: [],
    },
    activeCell: null,
  }
}

function createDefaultLogViewState(): TabLogViewState {
  return {
    query: "",
    statuses: [],
    followTail: true,
  }
}

function createTabState(options?: {
  label?: string
  sql?: string
  connection?: Config
}): TabState {
  return {
    id: String(nextTabId++),
    label: options?.label ?? "",
    connection: options?.connection,
    sql: options?.sql ?? "",
    editor: createDefaultEditorState(),
    result: createDefaultResultState(),
    table: createDefaultTableState(),
    logEntries: [],
    logView: createDefaultLogViewState(),
  }
}

function applyStateUpdater<T extends object>(
  current: T,
  updater: StateUpdater<T>,
): T {
  return typeof updater === "function"
    ? updater(current)
    : { ...current, ...updater }
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

function replaceLogEntry(
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

function getQueryResultRowCount(result: QueryResult): number {
  return typeof result.rowCount === "number"
    ? result.rowCount
    : result.rows.length
}

function reconcileTableState(
  table: TabTableState,
  columns: TabResultState["columns"],
): TabTableState {
  const validColumnIds = new Set(columns.map((column) => column.id))

  return {
    sorting: table.sorting.filter((item) => validColumnIds.has(item.id)),
    columnVisibility: Object.fromEntries(
      Object.entries(table.columnVisibility).filter(([id]) =>
        validColumnIds.has(id),
      ),
    ),
    columnSizing: Object.fromEntries(
      Object.entries(table.columnSizing).filter(([id]) =>
        validColumnIds.has(id),
      ),
    ),
    columnPinning: {
      left: table.columnPinning.left.filter((id) => validColumnIds.has(id)),
      right: table.columnPinning.right.filter((id) => validColumnIds.has(id)),
    },
    activeCell: null,
  }
}

function updateTabState(
  tabs: TabState[],
  tabId: string,
  updater: (current: TabState) => TabState,
): TabState[] {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
}

function updateActiveTab(
  get: Getter,
  set: Setter,
  updater: (tab: TabState, activeTabId: string) => TabState,
) {
  const activeTabId = get(activeTabIdAtom)
  if (!activeTabId) {
    return
  }

  set(_tabsAtom, (current) =>
    updateTabState(current, activeTabId, (tab) => updater(tab, activeTabId)),
  )
}

async function runTabSql(get: Getter, set: Setter, tabId: string) {
  const tab = get(_tabsAtom).find((item) => item.id === tabId)
  if (!tab) {
    return
  }

  const sql = tab.sql
  const trimmedSql = sql.trim()

  if (!trimmedSql) {
    set(_tabsAtom, (current) =>
      updateTabState(current, tabId, (currentTab) => ({
        ...currentTab,
        result: {
          ...currentTab.result,
          status: "error",
          lastRunSql: sql,
          lastRunAt: null,
          durationMs: 0,
          columns: [],
          rows: [],
          rowCount: 0,
          error: "SQL 不能为空",
        },
        logEntries: trimLogs([
          ...currentTab.logEntries,
          createLogEntry("error", sql, "SQL 不能为空", {
            detail: "请输入要执行的 SQL 语句",
            finishedAt: Date.now(),
          }),
        ]),
      })),
    )
    return
  }

  if (!tab.connection) {
    set(_tabsAtom, (current) =>
      updateTabState(current, tabId, (currentTab) => ({
        ...currentTab,
        result: {
          ...currentTab.result,
          status: "error",
          lastRunSql: sql,
          lastRunAt: null,
          durationMs: 0,
          columns: [],
          rows: [],
          rowCount: 0,
          error: "该标签页未绑定数据库连接",
        },
        logEntries: trimLogs([
          ...currentTab.logEntries,
          createLogEntry("error", sql, "该标签页未绑定数据库连接", {
            detail: "请先为当前标签页选择数据库连接",
            finishedAt: Date.now(),
          }),
        ]),
      })),
    )
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", sql, "正在执行 SQL", {
    detail: "正在等待数据库返回结果",
    startedAt,
  })

  set(_tabsAtom, (current) =>
    updateTabState(current, tabId, (currentTab) => ({
      ...currentTab,
      result: {
        ...currentTab.result,
        status: "running",
        error: null,
      },
      logEntries: trimLogs([...currentTab.logEntries, runningLog]),
    })),
  )

  try {
    const result = await connApi.query(tab.connection, sql)
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()

    set(_tabsAtom, (current) => {
      if (!current.some((item) => item.id === tabId)) {
        return current
      }

      return updateTabState(current, tabId, (currentTab) => ({
        ...currentTab,
        result: {
          status: "success",
          lastRunSql: sql,
          lastRunAt: finishedAt,
          durationMs,
          columns: result.columns,
          rows: result.rows,
          rowCount: getQueryResultRowCount(result),
          error: null,
        },
        table: reconcileTableState(currentTab.table, result.columns),
        logEntries: trimLogs(
          replaceLogEntry(
            currentTab.logEntries,
            runningLog.id,
            (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: "success",
              summary: `返回 ${getQueryResultRowCount(result)} 行`,
              detail: undefined,
              finishedAt,
              durationMs,
            }),
          ),
        ),
      }))
    })
  } catch (error) {
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : "查询执行失败"

    set(_tabsAtom, (current) => {
      if (!current.some((item) => item.id === tabId)) {
        return current
      }

      return updateTabState(current, tabId, (currentTab) => ({
        ...currentTab,
        result: {
          status: "error",
          lastRunSql: sql,
          lastRunAt: finishedAt,
          durationMs,
          columns: [],
          rows: [],
          rowCount: 0,
          error: message,
        },
        logEntries: trimLogs(
          replaceLogEntry(
            currentTab.logEntries,
            runningLog.id,
            (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: "error",
              summary: message,
              detail: message,
              finishedAt,
              durationMs,
            }),
          ),
        ),
      }))
    })
  }
}
