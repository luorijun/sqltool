import { atom } from "jotai"
import type { Config } from "@/lib/conn"
import connApi, { connectionEntriesAtom } from "@/lib/conn/renderer"
import type {
  QueryTabEditorState,
  QueryTabLoggerState,
  QueryTabState,
  QueryTabTableState,
  TabLogEntry,
  TabLogStatus,
  TabMeta,
  TabState,
} from "./index"

let nextTabId = 1
let nextLogId = 1

const MAX_TAB_LOG_ENTRIES = 300
const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type StateAction<T extends object> = T | ((current: T) => T)
type TabStateMap = Record<string, TabState>

type OpenQueryTabOptions = {
  label?: string
  configId?: string
  text?: string
  autoRun?: boolean
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
export const activeQueryTabLoggerAtom = atom(
  (get) => getActiveQueryTab(get).logger,
  (get, set, action: StateAction<QueryTabLoggerState>) => {
    const tabId = getActiveQueryTab(get).id
    set(tabStatesAtom, (states) =>
      updateQueryTabLoggerState(states, tabId, action),
    )
  },
)

// ====================
// actions
// ====================

export const openQueryTabAtom = atom(
  null,
  async (_get, set, opts?: OpenQueryTabOptions) => {
    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "query",
      label: opts?.label ?? `查询 ${id}`,
      configId: opts?.configId,
      table: createDefaultQueryTableState(),
      editor: createDefaultQueryEditorState(opts?.text),
      logger: createDefaultQueryLoggerState(),
    } satisfies QueryTabState

    set(tabsAtom, (tabs) => [...tabs, toTabMeta(tab)])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeTabIdAtom, id)

    if (opts?.autoRun && tab.editor.text) {
      await set(runQueryTabSqlByIdAtom, id)
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

function getActiveQueryTab(
  get: (atom: typeof activeTabAtom) => TabState | null,
): QueryTabState {
  const tab = get(activeTabAtom)
  if (!tab || tab.kind !== "query") {
    throw new Error("当前活动标签页不是查询标签页")
  }

  return tab
}

function toTabMeta(tab: TabState): TabMeta {
  return {
    id: tab.id,
    kind: tab.kind,
    label: tab.label,
  }
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
  action: StateAction<QueryTabLoggerState>,
): TabStateMap {
  return updateQueryTabState(states, tabId, (current) => {
    const logger = applyStateAction(current.logger, action)
    return Object.is(logger, current.logger) ? current : { ...current, logger }
  })
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

function createDefaultQueryLoggerState(): QueryTabLoggerState {
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
