import { atom } from "jotai"
import type { Getter, Setter } from "jotai/vanilla"
import type { Config } from "@/lib/config"
import connApi from "@/lib/conn/renderer"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string
  label: string
  dirty?: boolean
}

export type TabLogStatus = "success" | "error" | "info" | "running"

export interface TabLogEntry {
  id: string
  time: string
  status: TabLogStatus
  sql: string
  detail?: string
  duration?: number
}

/**
 * Snapshot of execution results stored per tab.
 *
 * Kept intentionally separate from `tabSqlAtom` so that live SQL edits in the
 * code editor do NOT trigger re-renders in TableArea / ExecLog — those panels
 * only care about whether/when a query was executed, not the in-progress text.
 */
export interface TabContent {
  /** The SQL that was executed most recently for this tab */
  sql: string
  connection?: Config
  executed: boolean
  running: boolean
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  executedAt: string
  error?: string
  logs: TabLogEntry[]
}

export interface AddTabOptions {
  label?: string
  /** Pre-fill the code editor */
  sql?: string
  connection?: Config
  autoRun?: boolean
}

// ─── ID Counter ───────────────────────────────────────────────────────────────

let nextTabId = 1
let nextLogId = 1

// ─── Core Atoms ───────────────────────────────────────────────────────────────

/** All open tabs (metadata only — no content) */
export const tabsAtom = atom<Tab[]>([])

/**
 * ID of the currently active tab.
 * Empty string (`""`) means no tab is active.
 *
 * NOTE: We intentionally avoid `atom<string | null>(null)` here.
 * Without `strictNullChecks` in tsconfig, TypeScript treats `null` as
 * assignable to function types, which causes jotai to resolve the
 * read-only overload `atom(read: Read<T>)` instead of the writable
 * `atom(initialValue, write)` overload, yielding an `Atom<T>` that
 * cannot be passed to `set()` inside other write functions.
 * A non-null, non-function sentinel value (`""`) sidesteps this entirely.
 */
export const activeTabIdAtom = atom("")

/** Per-tab live SQL editor content (updated on every keystroke) */
export const tabSqlAtom = atom<Record<string, string>>({})

/** Per-tab execution state and logs */
export const tabContentAtom = atom<Record<string, TabContent>>({})

// ─── Derived Atoms ────────────────────────────────────────────────────────────

/** The currently active Tab object, or null */
export const activeTabAtom = atom<Tab | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  return get(tabsAtom).find((t) => t.id === activeId) || null
})

/** Whether any tabs are currently open */
export const hasTabsAtom = atom((get) => get(tabsAtom).length > 0)

/**
 * Live SQL of the active tab (empty string when no tab is active).
 * Subscribing to this atom re-renders on every keystroke in the code editor.
 * Components that do NOT need real-time SQL (TableArea, ExecLog) should use
 * `activeTabContentAtom` instead to avoid unnecessary re-renders.
 */
export const activeTabSqlAtom = atom((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return ""
  const all = get(tabSqlAtom)
  const value = all[activeId]
  return value || ""
})

/**
 * Execution result metadata of the active tab, or null if the tab has never
 * been initialized.
 */
export const activeTabContentAtom = atom<TabContent | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  const all = get(tabContentAtom)
  const content = all[activeId]
  return content || null
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":")
}

function createDefaultContent(connection?: Config): TabContent {
  return {
    sql: "",
    connection,
    executed: false,
    running: false,
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    executedAt: "",
    logs: [],
  }
}

function ensureTabContent(
  get: Getter,
  set: Setter,
  tabId: string,
  connection?: Config,
): TabContent {
  const existing = get(tabContentAtom)[tabId]
  if (existing) {
    return existing
  }

  const content = createDefaultContent(connection)
  setTabContent(get, set, tabId, content)
  return content
}

function createLogEntry(
  status: TabLogStatus,
  sql: string,
  detail?: string,
  duration?: number,
): TabLogEntry {
  return {
    id: String(nextLogId++),
    time: formatTime(new Date()),
    status,
    sql,
    detail,
    duration,
  }
}

function getTabContent(get: Getter, tabId: string): TabContent {
  const existing = get(tabContentAtom)[tabId]
  if (existing) {
    return existing
  }

  return createDefaultContent()
}

function setTabContent(
  get: Getter,
  set: Setter,
  tabId: string,
  content: TabContent,
) {
  set(tabContentAtom, { ...get(tabContentAtom), [tabId]: content })
}

function hasTab(get: Getter, tabId: string): boolean {
  return get(tabsAtom).some((tab) => tab.id === tabId)
}

function syncTabDirty(get: Getter, set: Setter, tabId: string, executedSql: string) {
  const currentSql = get(tabSqlAtom)[tabId] || ""
  set(
    tabsAtom,
    get(tabsAtom).map((tab) =>
      tab.id === tabId ? { ...tab, dirty: currentSql !== executedSql } : tab,
    ),
  )
}

async function runTabSql(get: Getter, set: Setter, tabId: string) {
  const editorSql = get(tabSqlAtom)[tabId] || ""
  const sql = editorSql.trim()
  const content = ensureTabContent(get, set, tabId)

  if (!sql) {
    const nextContent: TabContent = {
      ...content,
      sql: editorSql,
      executed: false,
      running: false,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      executedAt: "",
      error: "SQL 不能为空",
      logs: [
        ...content.logs,
        createLogEntry("error", editorSql, "SQL 不能为空"),
      ],
    }
    setTabContent(get, set, tabId, nextContent)
    syncTabDirty(get, set, tabId, editorSql)
    return
  }

  if (!content.connection) {
    const nextContent: TabContent = {
      ...content,
      sql: editorSql,
      executed: false,
      running: false,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      executedAt: "",
      error: "该标签页未绑定数据库连接",
      logs: [
        ...content.logs,
        createLogEntry("error", editorSql, "该标签页未绑定数据库连接"),
      ],
    }
    setTabContent(get, set, tabId, nextContent)
    syncTabDirty(get, set, tabId, editorSql)
    return
  }

  const runningLog = createLogEntry("running", editorSql, "正在执行 SQL")

  setTabContent(get, set, tabId, {
    ...content,
    sql: editorSql,
    running: true,
    error: undefined,
    logs: [...content.logs, runningLog],
  })

  const startedAt = Date.now()

  try {
    const result = await connApi.query(content.connection, editorSql)
    const durationMs = Math.max(1, Date.now() - startedAt)
    const executedAt = formatTime(new Date())
    const rowCount =
      typeof result.rowCount === "number" ? result.rowCount : result.rows.length

    if (!hasTab(get, tabId)) {
      return
    }

    const latest = getTabContent(get, tabId)

    setTabContent(get, set, tabId, {
      ...latest,
      sql: editorSql,
      executed: true,
      running: false,
      columns: result.columns,
      rows: result.rows,
      rowCount,
      durationMs,
      executedAt,
      error: undefined,
      logs: [
        ...latest.logs.filter((entry) => entry.id !== runningLog.id),
        createLogEntry("success", editorSql, `返回 ${rowCount} 行`, durationMs),
      ],
    })
    syncTabDirty(get, set, tabId, editorSql)
  } catch (err) {
    const durationMs = Math.max(1, Date.now() - startedAt)
    const message = err instanceof Error ? err.message : "查询执行失败"

    if (!hasTab(get, tabId)) {
      return
    }

    const latest = getTabContent(get, tabId)

    setTabContent(get, set, tabId, {
      ...latest,
      sql: editorSql,
      executed: false,
      running: false,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs,
      executedAt: formatTime(new Date()),
      error: message,
      logs: [
        ...latest.logs.filter((entry) => entry.id !== runningLog.id),
        createLogEntry("error", editorSql, message, durationMs),
      ],
    })
    syncTabDirty(get, set, tabId, editorSql)
  }
}

// ─── Action Atoms ─────────────────────────────────────────────────────────────
//
// All write-only atoms use `false` (not `null`) as their initial value.
// Reason: see the `activeTabIdAtom` note above — without `strictNullChecks`,
// `null` is assignable to function types and causes jotai to pick the wrong
// overload, making the resulting atom read-only.

/** Create a new tab, optionally pre-populated with SQL */
export const addTabAtom = atom(
  false,
  async (get, set, options?: AddTabOptions) => {
    const id = String(nextTabId++)
    const label = options?.label ? options.label : `查询 ${id}`
    const newTab: Tab = { id, label }

    set(tabsAtom, [...get(tabsAtom), newTab])
    set(activeTabIdAtom, id)

    const sql = options?.sql || ""
    set(tabSqlAtom, { ...get(tabSqlAtom), [id]: sql })
    setTabContent(get, set, id, createDefaultContent(options?.connection))

    if (options?.autoRun && sql) {
      await runTabSql(get, set, id)
    }
  },
)

/** Close a tab by id; activates the nearest remaining tab */
export const closeTabAtom = atom(false, (get, set, id: string) => {
  const tabs = get(tabsAtom)
  const activeId = get(activeTabIdAtom)
  const next = tabs.filter((t) => t.id !== id)

  if (activeId === id) {
    if (next.length > 0) {
      const closedIndex = tabs.findIndex((t) => t.id === id)
      const newActive = next[Math.max(0, closedIndex - 1)]
      set(activeTabIdAtom, newActive.id)
    } else {
      set(activeTabIdAtom, "")
    }
  }

  set(tabsAtom, next)

  // Clean up per-tab state to avoid memory leaks on long sessions
  const nextSql = { ...get(tabSqlAtom) }
  delete nextSql[id]
  set(tabSqlAtom, nextSql)

  const nextContent = { ...get(tabContentAtom) }
  delete nextContent[id]
  set(tabContentAtom, nextContent)
})

/** Set the active tab by id */
export const selectTabAtom = atom(false, (_get, set, id: string) => {
  set(activeTabIdAtom, id)
})

/** Update the SQL of the currently active tab (called on every editor keystroke) */
export const updateActiveSqlAtom = atom(false, (get, set, sql: string) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return

  set(tabSqlAtom, { ...get(tabSqlAtom), [activeId]: sql })

  ensureTabContent(get, set, activeId)
  const content = getTabContent(get, activeId)

  set(
    tabsAtom,
    get(tabsAtom).map((t) =>
      t.id === activeId ? { ...t, dirty: sql !== content.sql } : t,
    ),
  )
})

/** Execute the SQL of the currently active tab */
export const runActiveTabSqlAtom = atom(false, async (get, set) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  await runTabSql(get, set, activeId)
})

/** Clear execution logs of the currently active tab */
export const clearActiveTabLogsAtom = atom(false, (get, set) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) {
    return
  }

  const content = getTabContent(get, activeId)
  setTabContent(get, set, activeId, {
    ...content,
    logs: [],
  })
})

/** Mark a tab as dirty (unsaved changes) or clean */
export const setTabDirtyAtom = atom(
  false,
  (get, set, { id, dirty }: { id: string; dirty: boolean }) => {
    set(
      tabsAtom,
      get(tabsAtom).map((t) => (t.id === id ? { ...t, dirty } : t)),
    )
  },
)

/** Rename a tab */
export const renameTabAtom = atom(
  false,
  (get, set, { id, label }: { id: string; label: string }) => {
    set(
      tabsAtom,
      get(tabsAtom).map((t) => (t.id === id ? { ...t, label } : t)),
    )
  },
)
