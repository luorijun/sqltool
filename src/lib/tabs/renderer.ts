import { atom } from "jotai"
import type { Config } from "@/lib/conn"
import connApi, { connectionEntriesAtom } from "@/lib/conn/renderer"
import type {
  TabEditorState,
  TabLogEntry,
  TabLogStatus,
  TabTableState,
} from "./index"

let nextTabId = 1
let nextLogId = 1

const MAX_TAB_LOG_ENTRIES = 300
const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type TabMeta = {
  id: string
  label: string
  configId?: string
}

interface TabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

type StateAction<T extends object> = T | ((current: T) => T)
type TabStateMap<T> = Record<string, T>

// ====================
// 标签页
// ====================

export const tabsAtom = atom<TabMeta[]>([])

// ====================
// 活跃标签页
// ====================

export const activeTabIdAtom = atom(null as string | null)
const tabTableStatesAtom = atom<TabStateMap<TabTableState>>({})
const tabEditorStatesAtom = atom<TabStateMap<TabEditorState>>({})
const tabLoggerStatesAtom = atom<TabStateMap<TabLoggerState>>({})
export const hasActiveTabAtom = atom((get) => {
  const tabs = get(tabsAtom)
  const activeTabId = get(activeTabIdAtom)
  return (
    tabs.length > 0 &&
    activeTabId !== null &&
    activeTabId in get(tabTableStatesAtom) &&
    activeTabId in get(tabEditorStatesAtom) &&
    activeTabId in get(tabLoggerStatesAtom)
  )
})

// 标签页
const activeTabAtom = atom<TabMeta>((get) => {
  const activeTabId = get(activeTabIdAtom)
  return get(tabsAtom).find((tab) => tab.id === activeTabId)
})

// 连接配置
export const activeTabConfigAtom = atom<Config | undefined>((get) => {
  const configId = get(activeTabAtom).configId
  if (!configId) {
    return undefined
  }

  return get(connectionEntriesAtom)?.find(
    (connection) => connection.config.id === configId,
  )?.config
})

// 表格 ui 状态
export const activeTabTableStateAtom = atom(
  (get) => get(tabTableStatesAtom)[get(activeTabAtom).id],
  (get, set, action: StateAction<TabTableState>) => {
    const tabId = get(activeTabAtom).id
    set(tabTableStatesAtom, (states) => {
      const current = states[tabId]
      const next = typeof action === "function" ? action(current) : action
      return Object.is(next, current) ? states : { ...states, [tabId]: next }
    })
  },
)

// 编辑器 ui 状态
export const activeTabEditorStateAtom = atom(
  (get) => get(tabEditorStatesAtom)[get(activeTabAtom).id],
  (get, set, action: StateAction<TabEditorState>) => {
    const tabId = get(activeTabAtom).id
    set(tabEditorStatesAtom, (states) => {
      const current = states[tabId]
      const next = typeof action === "function" ? action(current) : action
      return Object.is(next, current) ? states : { ...states, [tabId]: next }
    })
  },
)

// 日志 ui 状态
export const activeTabLoggerAtom = atom(
  (get) => get(tabLoggerStatesAtom)[get(activeTabAtom).id],
  (get, set, action: StateAction<TabLoggerState>) => {
    const tabId = get(activeTabAtom).id
    set(tabLoggerStatesAtom, (states) => {
      const current = states[tabId]
      const next = typeof action === "function" ? action(current) : action
      return Object.is(next, current) ? states : { ...states, [tabId]: next }
    })
  },
)

// ====================
// actions
// ====================

export const createTabAtom = atom(
  null,
  async (
    _get,
    set,
    opts?: {
      label?: string
      configId?: string
      text?: string
      autoRun?: boolean
    },
  ) => {
    const id = String(nextTabId++)
    const table = createDefaultTableState()
    const editor = createDefaultEditorState(opts?.text)
    const tab = {
      id,
      label: opts?.label ?? `查询 ${id}`,
      configId: opts?.configId,
    } satisfies TabMeta

    set(tabsAtom, (tabs) => [...tabs, tab])
    set(tabTableStatesAtom, (states) => ({ ...states, [id]: table }))
    set(tabEditorStatesAtom, (states) => ({ ...states, [id]: editor }))
    set(tabLoggerStatesAtom, (states) => ({
      ...states,
      [id]: {
        query: "",
        statuses: [],
        followTail: true,
        logs: [],
      },
    }))
    set(activeTabIdAtom, id)

    if (opts?.autoRun && editor.text) {
      await set(runTabSqlByIdAtom, id)
    }
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
  set(tabTableStatesAtom, (states) => deleteTabState(states, tabId))
  set(tabEditorStatesAtom, (states) => deleteTabState(states, tabId))
  set(tabLoggerStatesAtom, (states) => deleteTabState(states, tabId))
})

export const resetActiveTabTableStateAtom = atom(null, (_get, set) => {
  set(activeTabTableStateAtom, (current) => ({
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

// 内部 action atom，复用同一套 SQL 执行流程。
const runTabSqlByIdAtom = atom(null, async (get, set, tabId: string) => {
  const tab = get(tabsAtom).find((item) => item.id === tabId)
  const editor = get(tabEditorStatesAtom)[tabId]
  if (!tab || !editor) {
    return
  }

  const sql = editor.text
  const trimmedSql = sql.trim()

  if (!trimmedSql) {
    const finishedAt = Date.now()

    set(tabTableStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: "SQL 不能为空",
        dataAt: finishedAt,
      })),
    )
    set(tabLoggerStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
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

    set(tabTableStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: "该标签页未绑定数据库连接",
        dataAt: finishedAt,
      })),
    )
    set(tabLoggerStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
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

  set(tabTableStatesAtom, (states) =>
    updateTabStateMap(states, tabId, (current) => ({
      ...current,
      status: "running",
      error: null,
    })),
  )
  set(tabEditorStatesAtom, (states) =>
    updateTabStateMap(states, tabId, (current) => ({
      ...current,
      status: "running",
    })),
  )
  set(tabLoggerStatesAtom, (states) =>
    updateTabStateMap(states, tabId, (current) => ({
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

    set(tabTableStatesAtom, (states) =>
      updateTabStateMap(states, tabId, {
        ...createDefaultTableState(),
        status: "success",
        error: null,
        dataAt: finishedAt,
        columns: result.columns,
        data: result.rows.map((row) => {
          return result.columns.reduce(
            (acc, col, index) => {
              acc[col.id] = row[index]
              return acc
            },
            {} as Record<string, unknown>,
          )
        }),
      }),
    )
    set(tabEditorStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
        ...current,
        status: "idle",
      })),
    )
    set(tabLoggerStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
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

    set(tabTableStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
        ...current,
        status: "error",
        error: message,
        dataAt: finishedAt,
      })),
    )
    set(tabEditorStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
        ...current,
        status: "idle",
      })),
    )
    set(tabLoggerStatesAtom, (states) =>
      updateTabStateMap(states, tabId, (current) => ({
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

export const runActiveTabSqlAtom = atom(null, async (get, set) => {
  await set(runTabSqlByIdAtom, get(activeTabAtom).id)
})

// helper

function updateTabStateMap<T extends object>(
  states: TabStateMap<T>,
  tabId: string,
  action: StateAction<T>,
): TabStateMap<T> {
  const current = states[tabId]
  if (!current) {
    return states
  }

  const next = typeof action === "function" ? action(current) : action
  return Object.is(next, current) ? states : { ...states, [tabId]: next }
}

function deleteTabState<T>(
  states: TabStateMap<T>,
  tabId: string,
): TabStateMap<T> {
  if (!(tabId in states)) {
    return states
  }

  const { [tabId]: _deleted, ...nextStates } = states
  return nextStates
}

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
