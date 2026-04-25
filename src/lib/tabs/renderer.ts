import { atom } from "jotai"
import type { Getter, Setter } from "jotai/vanilla"
import type { Config } from "@/lib/config"
import type { QueryResult } from "@/lib/conn"
import connApi from "@/lib/conn/renderer"
import type {
  Tab,
  TabEditorState,
  TabLogEntry,
  TabLoggerState,
  TabLogStatus,
  TabTableState,
} from "./index"

let nextTabId = 1
let nextLogId = 1

const MAX_TAB_LOG_ENTRIES = 300
const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type StateUpdater<T extends object> =
  | Partial<T>
  | ((current: T) => Partial<T> | null)

// ====================
// 标签页
// ====================

const _tabsAtom = atom<Tab[]>([])

export const tabsAtom = atom((get) => get(_tabsAtom))
export const hasTabsAtom = atom((get) => get(_tabsAtom).length > 0)

// ====================
// 活跃标签页
// ====================

export const activeTabIdAtom = atom(null as string | null)

// 标签页
const activeTabAtom = atom<Tab>((get) => {
  const activeTabId = get(activeTabIdAtom)
  if (!activeTabId) {
    throw new Error("活动标签页不存在")
  }
  const activeTab = get(_tabsAtom).find((tab) => tab.id === activeTabId)
  if (!activeTab) {
    throw new Error("活动标签页不存在")
  }
  return activeTab
})

// 连接配置
export const activeTabConfigAtom = atom<Config | undefined>((get) => {
  return get(activeTabAtom).config
})

// 表格 ui 状态
export const activeTabTableStateAtom = atom(
  (get) => get(activeTabAtom).table,
  (get, set, updater: StateUpdater<TabTableState>) => {
    updateTabById(set, get(activeTabAtom).id, (tab) => {
      const table = applyPatch(tab.table, updater)
      return table === tab.table ? tab : { ...tab, table }
    })
  },
)

// 编辑器 ui 状态
export const activeTabEditorStateAtom = atom(
  (get) => get(activeTabAtom).editor,
  (get, set, updater: StateUpdater<TabEditorState>) => {
    updateTabById(set, get(activeTabAtom).id, (tab) => {
      const editor = applyPatch(tab.editor, updater)
      return editor === tab.editor ? tab : { ...tab, editor }
    })
  },
)

// 日志 ui 状态
export const activeTabLoggerAtom = atom(
  (get) => get(activeTabAtom).logger,
  (get, set, updater: StateUpdater<TabLoggerState>) => {
    updateTabById(set, get(activeTabAtom).id, (tab) => {
      const logView = applyPatch(tab.logger, updater)
      return logView === tab.logger ? tab : { ...tab, logger: logView }
    })
  },
)

// ====================
// actions
// ====================

export const createTabAtom = atom(
  false,
  async (
    get,
    set,
    opts?: {
      label?: string
      config?: Config
      text?: string
      autoRun?: boolean
    },
  ) => {
    const id = String(nextTabId++)
    const tab = {
      id,
      label: opts?.label ?? `查询 ${id}`,
      config: opts?.config,
      table: createDefaultTableState(),
      editor: createDefaultEditorState(opts?.text),
      logger: createDefaultLoggerState(),
    } satisfies Tab

    set(_tabsAtom, [...get(_tabsAtom), tab])
    set(activeTabIdAtom, tab.id)

    if (opts?.autoRun && tab.editor.text) {
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
  updateTabById(set, get(activeTabAtom).id, (tab) => ({
    ...tab,
    table: {
      ...tab.table,
      sorting: [],
      visibility: {},
      sizing: {},
      pinning: {
        left: [],
        right: [],
      },
      selected: null,
    },
  }))
})

export const runActiveTabSqlAtom = atom(false, async (get, set) => {
  await runTabSql(get, set, get(activeTabAtom).id)
})

// helper

function createDefaultTableState(): TabTableState {
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

function createDefaultEditorState(text = ""): TabEditorState {
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

function updateTabById(
  set: Setter,
  tabId: string,
  updater: (current: Tab) => Tab,
) {
  set(_tabsAtom, (tabs) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index === -1) {
      return tabs
    }

    const currentTab = tabs[index]
    const nextTab = updater(currentTab)
    if (nextTab === currentTab) {
      return tabs
    }

    const nextTabs = [...tabs]
    nextTabs[index] = nextTab
    return nextTabs
  })
}

function applyPatch<T extends object>(current: T, updater: StateUpdater<T>): T {
  const patch = typeof updater === "function" ? updater(current) : updater
  if (!patch) {
    return current
  }

  for (const [key, value] of Object.entries(patch) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (!Object.is(current[key], value)) {
      return { ...current, ...patch }
    }
  }

  return current
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

function getQueryResultRowCount(result: QueryResult): number {
  return typeof result.rowCount === "number"
    ? result.rowCount
    : result.rows.length
}

async function runTabSql(get: Getter, set: Setter, tabId: string) {
  const tab = get(_tabsAtom).find((item) => item.id === tabId)
  if (!tab) {
    return
  }

  const sql = tab.editor.text
  const trimmedSql = sql.trim()

  if (!trimmedSql) {
    updateTabById(set, tabId, (currentTab) => ({
      ...currentTab,
      table: {
        ...currentTab.table,
        status: "error",
        error: "SQL 不能为空",
        dataAt: Date.now(),
      },
      logger: {
        ...currentTab.logger,
        logs: trimLogs([
          ...currentTab.logger.logs,
          createLogEntry("error", sql, "SQL 不能为空", {
            detail: "请输入要执行的 SQL 语句",
            finishedAt: Date.now(),
          }),
        ]),
      },
    }))
    return
  }

  if (!tab.config) {
    updateTabById(set, tabId, (currentTab) => ({
      ...currentTab,
      table: {
        ...currentTab.table,
        status: "error",
        error: "该标签页未绑定数据库连接",
        dataAt: Date.now(),
      },
      logger: {
        ...currentTab.logger,
        logs: trimLogs([
          ...currentTab.logger.logs,
          createLogEntry("error", sql, "该标签页未绑定数据库连接", {
            detail: "请先为当前标签页选择数据库连接",
            finishedAt: Date.now(),
          }),
        ]),
      },
    }))
    return
  }

  if (tab.editor.status === "running") {
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", sql, "正在执行 SQL", {
    detail: "正在等待数据库返回结果",
    startedAt,
  })

  updateTabById(set, tabId, (currentTab) => ({
    ...currentTab,
    table: {
      ...currentTab.table,
      status: "running",
      error: null,
    },
    editor: {
      ...currentTab.editor,
      status: "running",
    },
    logger: {
      ...currentTab.logger,
      logs: trimLogs([...currentTab.logger.logs, runningLog]),
    },
  }))

  try {
    const result = await connApi.query(tab.config, sql)
    const rowCount = getQueryResultRowCount(result)
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()

    updateTabById(set, tabId, (currentTab) => ({
      ...currentTab,
      table: {
        ...createDefaultTableState(),
        status: "success",
        error: null,
        dataAt: finishedAt,
        columns: result.columns,
        data: result.rows.map((row) => {
          return result.columns.reduce(
            (acc, col, j) => {
              acc[col.id] = row[j]
              return acc
            },
            {} as Record<string, unknown>,
          )
        }),
      },
      editor: {
        ...currentTab.editor,
        status: "idle",
      },
      logger: {
        ...currentTab.logger,
        logs: trimLogs(
          upsertLogEntry(
            currentTab.logger.logs,
            runningLog.id,
            (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: "success",
              summary: `返回 ${rowCount} 行`,
              detail: undefined,
              finishedAt,
              durationMs,
            }),
          ),
        ),
      },
    }))
  } catch (error) {
    const durationMs = Math.max(1, Date.now() - startedAt)
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : "查询执行失败"

    updateTabById(set, tabId, (currentTab) => ({
      ...currentTab,
      table: {
        ...currentTab.table,
        status: "error",
        error: message,
        dataAt: finishedAt,
      },
      editor: {
        ...currentTab.editor,
        status: "idle",
      },
      logger: {
        ...currentTab.logger,
        logs: trimLogs(
          upsertLogEntry(
            currentTab.logger.logs,
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
      },
    }))
  }
}
