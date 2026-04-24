import { atom } from "jotai"
import type { Getter, Setter } from "jotai/vanilla"
import type { Config, DbDriver } from "@/lib/config"
import connApi from "@/lib/conn/renderer"
import type {
  AddTabOptions,
  Tab,
  TabData,
  TabEditorData,
  TabLogEntry,
  TabLogStatus,
  TabLogUiState,
  TabResultState,
  TabTableData,
} from "./index"

let nextTabId = 1
let nextLogId = 1
const MAX_TAB_LOG_ENTRIES = 300

const DEFAULT_CURSOR = { line: 1, col: 1 } as const

export const tabsAtom = atom<Tab[]>([])

export const activeTabIdAtom = atom("")

const tabDataAtom = atom<Record<string, TabData>>({})
const tabLogsByTabIdAtom = atom<Record<string, TabLogEntry[]>>({})
const tabLogUiByTabIdAtom = atom<Record<string, TabLogUiState>>({})

export const activeTabDataAtom = atom<TabData | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return null
  }

  return get(tabDataAtom)[activeId] ?? null
})

export const activeTabSqlAtom = atom((get) => get(activeTabDataAtom)?.sql ?? "")

export const activeTabEditorStateAtom = atom<TabEditorData | null>((get) => {
  return get(activeTabDataAtom)?.editor ?? null
})

export const activeTabConnectionAtom = atom<Config | undefined>((get) => {
  return get(activeTabDataAtom)?.connection
})

export const activeTabResultAtom = atom<TabResultState | null>((get) => {
  return get(activeTabDataAtom)?.result ?? null
})

export const activeTabLogsAtom = atom<TabLogEntry[]>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return []
  }

  return get(tabLogsByTabIdAtom)[activeId] ?? []
})

export const activeTabLogUiAtom = atom<TabLogUiState | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return null
  }

  return get(tabLogUiByTabIdAtom)[activeId] ?? createDefaultLogUiState()
})

export const activeTabTableUiAtom = atom<TabTableData | null>((get) => {
  return get(activeTabDataAtom)?.table ?? null
})

export const activeTabDialectAtom = atom<DbDriver>((get) => {
  const data = get(activeTabDataAtom)
  return data?.connection?.driver ?? data?.editor.dialectOverride ?? "postgres"
})

function formatTime(d: Date): string {
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":")
}

function createDefaultLogUiState(): TabLogUiState {
  return {
    query: "",
    statuses: [],
    followTail: true,
  }
}

function createDefaultEditorState(): TabEditorData {
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
    dialectOverride: undefined,
  }
}

function createDefaultResultState(): TabResultState {
  return {
    executedSql: "",
    executed: false,
    running: false,
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    executedAt: "",
  }
}

function createDefaultTableUiState(): TabTableData {
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

function reconcileTableUiState(
  table: TabTableData,
  columns: TabResultState["columns"],
): TabTableData {
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

function createDefaultTabData(connection?: Config, sql = ""): TabData {
  return {
    connection,
    sql,
    editor: createDefaultEditorState(),
    result: createDefaultResultState(),
    table: createDefaultTableUiState(),
  }
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
  const startedAt = options?.startedAt ?? Date.now()

  return {
    id: String(nextLogId++),
    status,
    sql,
    summary,
    detail: options?.detail,
    startedAt,
    finishedAt: options?.finishedAt,
    durationMs: options?.durationMs,
  }
}

function trimLogs(entries: TabLogEntry[]): TabLogEntry[] {
  if (entries.length <= MAX_TAB_LOG_ENTRIES) {
    return entries
  }

  return entries.slice(entries.length - MAX_TAB_LOG_ENTRIES)
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

function getTabData(get: Getter, tabId: string): TabData | undefined {
  return get(tabDataAtom)[tabId]
}

function hasTab(get: Getter, tabId: string): boolean {
  return get(tabsAtom).some((tab) => tab.id === tabId)
}

function getTabLogs(get: Getter, tabId: string): TabLogEntry[] {
  return get(tabLogsByTabIdAtom)[tabId] ?? []
}

function setTabLogs(
  get: Getter,
  set: Setter,
  tabId: string,
  logs: TabLogEntry[],
) {
  set(tabLogsByTabIdAtom, {
    ...get(tabLogsByTabIdAtom),
    [tabId]: trimLogs(logs),
  })
}

function updateTabLogs(
  get: Getter,
  set: Setter,
  tabId: string,
  updater: (logs: TabLogEntry[]) => TabLogEntry[],
): TabLogEntry[] {
  const nextLogs = trimLogs(updater(getTabLogs(get, tabId)))
  setTabLogs(get, set, tabId, nextLogs)
  return nextLogs
}

function setTabLogUi(
  get: Getter,
  set: Setter,
  tabId: string,
  nextLogUi: TabLogUiState,
) {
  set(tabLogUiByTabIdAtom, {
    ...get(tabLogUiByTabIdAtom),
    [tabId]: nextLogUi,
  })
}

function setTabData(
  get: Getter,
  set: Setter,
  tabId: string,
  nextData: TabData,
) {
  set(tabDataAtom, {
    ...get(tabDataAtom),
    [tabId]: nextData,
  })
}

function updateTabData(
  get: Getter,
  set: Setter,
  tabId: string,
  updater: (data: TabData) => TabData,
): TabData | undefined {
  const current = getTabData(get, tabId)
  if (!current) {
    return undefined
  }

  const nextData = updater(current)
  setTabData(get, set, tabId, nextData)
  return nextData
}

function updateTabMeta(
  get: Getter,
  set: Setter,
  tabId: string,
  updater: (tab: Tab) => Tab,
) {
  set(
    tabsAtom,
    get(tabsAtom).map((tab) => (tab.id === tabId ? updater(tab) : tab)),
  )
}

function syncTabDirty(get: Getter, set: Setter, tabId: string) {
  const data = getTabData(get, tabId)
  if (!data) {
    return
  }

  updateTabMeta(get, set, tabId, (tab) => ({
    ...tab,
    dirty: data.sql !== data.result.executedSql,
  }))
}

async function runTabSql(get: Getter, set: Setter, tabId: string) {
  const data = getTabData(get, tabId)
  if (!data) {
    return
  }

  const editorSql = data.sql
  const trimmedSql = editorSql.trim()

  if (!trimmedSql) {
    updateTabData(get, set, tabId, (current) => ({
      ...current,
      result: {
        ...current.result,
        executedSql: editorSql,
        executed: false,
        running: false,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        executedAt: "",
        error: "SQL 不能为空",
      },
    }))
    updateTabLogs(get, set, tabId, (logs) => [
      ...logs,
      createLogEntry("error", editorSql, "SQL 不能为空", {
        detail: "请输入要执行的 SQL 语句",
        finishedAt: Date.now(),
      }),
    ])
    syncTabDirty(get, set, tabId)
    return
  }

  if (!data.connection) {
    updateTabData(get, set, tabId, (current) => ({
      ...current,
      result: {
        ...current.result,
        executedSql: editorSql,
        executed: false,
        running: false,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        executedAt: "",
        error: "该标签页未绑定数据库连接",
      },
    }))
    updateTabLogs(get, set, tabId, (logs) => [
      ...logs,
      createLogEntry("error", editorSql, "该标签页未绑定数据库连接", {
        detail: "请先为当前标签页选择数据库连接",
        finishedAt: Date.now(),
      }),
    ])
    syncTabDirty(get, set, tabId)
    return
  }

  const startedAt = Date.now()
  const runningLog = createLogEntry("running", editorSql, "正在执行 SQL", {
    detail: "正在等待数据库返回结果",
    startedAt,
  })

  updateTabData(get, set, tabId, (current) => ({
    ...current,
    result: {
      ...current.result,
      running: true,
      error: undefined,
    },
  }))
  updateTabLogs(get, set, tabId, (logs) => [...logs, runningLog])

  try {
    const result = await connApi.query(data.connection, editorSql)
    const durationMs = Math.max(1, Date.now() - startedAt)
    const executedAt = formatTime(new Date())
    const rowCount =
      typeof result.rowCount === "number" ? result.rowCount : result.rows.length

    if (!hasTab(get, tabId)) {
      return
    }

    updateTabData(get, set, tabId, (current) => ({
      ...current,
      result: {
        ...current.result,
        executedSql: editorSql,
        executed: true,
        running: false,
        columns: result.columns,
        rows: result.rows,
        rowCount,
        durationMs,
        executedAt,
        error: undefined,
      },
      table: reconcileTableUiState(current.table, result.columns),
    }))
    updateTabLogs(get, set, tabId, (logs) =>
      replaceLogEntry(logs, runningLog.id, (current) => ({
        ...(current ?? runningLog),
        status: "success",
        summary: `返回 ${rowCount} 行`,
        detail: undefined,
        finishedAt: Date.now(),
        durationMs,
      })),
    )
    syncTabDirty(get, set, tabId)
  } catch (err) {
    const durationMs = Math.max(1, Date.now() - startedAt)
    const message = err instanceof Error ? err.message : "查询执行失败"

    if (!hasTab(get, tabId)) {
      return
    }

    updateTabData(get, set, tabId, (current) => ({
      ...current,
      result: {
        ...current.result,
        executedSql: editorSql,
        executed: false,
        running: false,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs,
        executedAt: formatTime(new Date()),
        error: message,
      },
    }))
    updateTabLogs(get, set, tabId, (logs) =>
      replaceLogEntry(logs, runningLog.id, (current) => ({
        ...(current ?? runningLog),
        status: "error",
        summary: message,
        detail: message,
        finishedAt: Date.now(),
        durationMs,
      })),
    )
    syncTabDirty(get, set, tabId)
  }
}

export const addTabAtom = atom(
  false,
  async (get, set, options?: AddTabOptions) => {
    const id = String(nextTabId++)
    const label = options?.label ?? `查询 ${id}`
    const sql = options?.sql ?? ""

    set(tabsAtom, [...get(tabsAtom), { id, label }])
    set(activeTabIdAtom, id)
    setTabData(get, set, id, createDefaultTabData(options?.connection, sql))
    setTabLogs(get, set, id, [])
    setTabLogUi(get, set, id, createDefaultLogUiState())

    if (options?.autoRun && sql) {
      await runTabSql(get, set, id)
    }
  },
)

export const closeTabAtom = atom(false, (get, set, id: string) => {
  const tabs = get(tabsAtom)
  const activeId = get(activeTabIdAtom)
  const nextTabs = tabs.filter((tab) => tab.id !== id)

  if (activeId === id) {
    if (nextTabs.length > 0) {
      const closedIndex = tabs.findIndex((tab) => tab.id === id)
      const newActive = nextTabs[Math.max(0, closedIndex - 1)]
      set(activeTabIdAtom, newActive.id)
    } else {
      set(activeTabIdAtom, "")
    }
  }

  set(tabsAtom, nextTabs)

  const nextData = { ...get(tabDataAtom) }
  delete nextData[id]
  set(tabDataAtom, nextData)

  const nextLogs = { ...get(tabLogsByTabIdAtom) }
  delete nextLogs[id]
  set(tabLogsByTabIdAtom, nextLogs)

  const nextLogUi = { ...get(tabLogUiByTabIdAtom) }
  delete nextLogUi[id]
  set(tabLogUiByTabIdAtom, nextLogUi)
})

export const renameTabAtom = atom(
  false,
  (get, set, { id, label }: { id: string; label: string }) => {
    updateTabMeta(get, set, id, (tab) => ({ ...tab, label }))
  },
)

export const updateActiveSqlAtom = atom(false, (get, set, sql: string) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  updateTabData(get, set, activeId, (current) => ({
    ...current,
    sql,
  }))
  syncTabDirty(get, set, activeId)
})

export const updateTabEditorStateAtom = atom(
  false,
  (
    get,
    set,
    {
      tabId,
      updater,
    }: {
      tabId: string
      updater:
        | Partial<TabEditorData>
        | ((current: TabEditorData) => TabEditorData)
    },
  ) => {
    updateTabData(get, set, tabId, (current) => ({
      ...current,
      editor:
        typeof updater === "function"
          ? updater(current.editor)
          : { ...current.editor, ...updater },
    }))
  },
)

export const updateActiveTabEditorStateAtom = atom(
  false,
  (
    get,
    set,
    updater:
      | Partial<TabEditorData>
      | ((current: TabEditorData) => TabEditorData),
  ) => {
    const activeId = get(activeTabIdAtom)
    if (!activeId) {
      return
    }

    set(updateTabEditorStateAtom, { tabId: activeId, updater })
  },
)

export const setActiveTabDialectOverrideAtom = atom(
  false,
  (get, set, dialect: DbDriver) => {
    const activeId = get(activeTabIdAtom)
    if (!activeId) {
      return
    }

    updateTabData(get, set, activeId, (current) => {
      if (current.connection) {
        return current
      }

      return {
        ...current,
        editor: {
          ...current.editor,
          dialectOverride: dialect,
        },
      }
    })
  },
)

export const updateActiveTabTableUiAtom = atom(
  false,
  (
    get,
    set,
    updater: Partial<TabTableData> | ((current: TabTableData) => TabTableData),
  ) => {
    const activeId = get(activeTabIdAtom)
    if (!activeId) {
      return
    }

    updateTabData(get, set, activeId, (current) => ({
      ...current,
      table:
        typeof updater === "function"
          ? updater(current.table)
          : { ...current.table, ...updater },
    }))
  },
)

export const resetActiveTabTableUiAtom = atom(false, (get, set) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  updateTabData(get, set, activeId, (current) => ({
    ...current,
    table: createDefaultTableUiState(),
  }))
})

export const runActiveTabSqlAtom = atom(false, async (get, set) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  await runTabSql(get, set, activeId)
})

export const clearActiveTabLogsAtom = atom(false, (get, set) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  setTabLogs(get, set, activeId, [])
})

export const updateActiveTabLogUiAtom = atom(
  false,
  (
    get,
    set,
    updater:
      | Partial<TabLogUiState>
      | ((current: TabLogUiState) => TabLogUiState),
  ) => {
    const activeId = get(activeTabIdAtom)
    if (!activeId) {
      return
    }

    const current =
      get(tabLogUiByTabIdAtom)[activeId] ?? createDefaultLogUiState()
    setTabLogUi(
      get,
      set,
      activeId,
      typeof updater === "function"
        ? updater(current)
        : { ...current, ...updater },
    )
  },
)
