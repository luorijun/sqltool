import { atom } from "jotai"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string
  label: string
  dirty?: boolean
}

/**
 * Snapshot of execution results stored per tab.
 *
 * Kept intentionally separate from `tabSqlAtom` so that live SQL edits in the
 * code editor do NOT trigger re-renders in TableArea / ExecLog — those panels
 * only care about whether/when a query was executed, not the in-progress text.
 */
export interface TabContent {
  /** The SQL that was auto-executed when the tab was opened */
  sql: string
  executed: boolean
  columns: string[]
  rowCount: number
  durationMs: number
  executedAt: string
}

export interface AddTabOptions {
  label?: string
  /** Pre-fill the code editor and auto-execute (mock) the query */
  sql?: string
  columns?: string[]
}

// ─── ID Counter ───────────────────────────────────────────────────────────────

let nextTabId = 1

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

/** Per-tab execution-result metadata (set once when the tab is opened with SQL) */
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
 * been auto-executed (i.e. it is a blank query tab created via the "+" button).
 * Only changes on tab switch or when a tab is opened with an initial query —
 * safe to subscribe to from TableArea and ExecLog without keystroke churn.
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

// ─── Action Atoms ─────────────────────────────────────────────────────────────
//
// All write-only atoms use `false` (not `null`) as their initial value.
// Reason: see the `activeTabIdAtom` note above — without `strictNullChecks`,
// `null` is assignable to function types and causes jotai to pick the wrong
// overload, making the resulting atom read-only.

/** Create a new tab, optionally pre-populated with an auto-executed SQL query */
export const addTabAtom = atom(false, (get, set, options?: AddTabOptions) => {
  const id = String(nextTabId++)
  const label = options?.label ? options.label : `查询 ${id}`
  const newTab: Tab = { id, label }

  set(tabsAtom, [...get(tabsAtom), newTab])
  set(activeTabIdAtom, id)

  if (options?.sql) {
    // Seed the editor with the initial SQL
    set(tabSqlAtom, { ...get(tabSqlAtom), [id]: options.sql })

    // Record the mock execution result; durationMs is deterministic (not random)
    // so it stays stable across re-renders without needing useState.
    const numId = parseInt(id, 10)
    const content: TabContent = {
      sql: options.sql,
      executed: true,
      columns: options.columns || [],
      rowCount: 20,
      durationMs: ((numId * 7) % 36) + 5, // 5–40 ms, deterministic
      executedAt: formatTime(new Date()),
    }
    set(tabContentAtom, { ...get(tabContentAtom), [id]: content })
  }
})

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
