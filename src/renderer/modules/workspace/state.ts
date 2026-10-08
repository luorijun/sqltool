import { atom } from "jotai"
import type { Config, QueryResult } from "@/contracts/database"
import { connectionsAtom, sessionsAtom } from "@/renderer/modules/database"
import type {
  CodeView,
  EditorView,
  LogState,
  QueryEditorState,
  QueryTableState,
  QueryTabState,
  TableLayout,
  TableSelection,
  TabMeta,
  TabState,
  ViewTableState,
  ViewTabState,
} from "./types"

const DEFAULT_VIEW_PAGE_SIZE = 100

const DEFAULT_CURSOR = { line: 1, col: 1 } as const

type StateAction<T extends object> = T | ((current: T) => T)

export type TabStateMap = Record<string, TabState>

export const tabOrderAtom = atom<string[]>([])

export const tabStatesAtom = atom<TabStateMap>({})

export const activeIdAtom = atom(null as string | null)

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
  return get(sessionsAtom).find((s) => s.id === tab?.sessionId)
})

export const activeResultStaleAtom = atom((get) => {
  const tab = get(activeTabAtom)
  if (!tab?.table.dataAt) return false
  if (tab.kind === "query") {
    const session = get(sessionsAtom).find((s) => s.id === tab.table.sessionId)
    return (
      !session ||
      session.status === "closed" ||
      session.status === "failed" ||
      session.id !== tab.sessionId
    )
  }
  const connection = get(connectionsAtom)?.find(
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

export const activeQueryConfigAtom = atom<Config | undefined>((get) => {
  const tab = get(activeQueryTabAtom)
  if (!tab?.configId) {
    return undefined
  }

  return get(connectionsAtom)?.find(
    (connection) => connection.config.id === tab.configId,
  )?.config
})

export const resetQueryLayoutAtom = atom(
  null,
  (_get, set, { tabId }: { tabId: string }) => {
    set(updateQueryLayoutAtom, {
      tabId,
      update: (current) => ({
        ...current,
        visibility: {},
        sizing: {},
        pinning: {
          start: [],
          end: [],
        },
      }),
    })
  },
)

export const resetViewLayoutAtom = atom(
  null,
  (_get, set, { tabId }: { tabId: string }) => {
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
      }),
    })
  },
)

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

export function updateQueryTab(
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

export function updateViewTab(
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

export function updateQueryTable(
  states: TabStateMap,
  tabId: string,
  action: StateAction<QueryTableState>,
): TabStateMap {
  return updateQueryTab(states, tabId, (current) => {
    const table = applyStateAction(current.table, action)
    return Object.is(table, current.table) ? current : { ...current, table }
  })
}

export function updateViewTable(
  states: TabStateMap,
  tabId: string,
  action: StateAction<ViewTableState>,
): TabStateMap {
  return updateViewTab(states, tabId, (current) => {
    const table = applyStateAction(current.table, action)
    return Object.is(table, current.table) ? current : { ...current, table }
  })
}

export function updateLog(
  states: TabStateMap,
  tabId: string,
  action: StateAction<LogState>,
): TabStateMap {
  const current = states[tabId]
  if (!current) {
    return states
  }

  const log = applyStateAction(current.log, action)
  if (Object.is(log, current.log)) {
    return states
  }
  return {
    ...states,
    [tabId]: {
      ...current,
      log,
    },
  }
}

export function toTableRows(result: QueryResult): Record<string, unknown>[] {
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

export function toTotalCount(value: unknown): number {
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

export function createViewTable(): ViewTableState {
  return {
    sort: [],
    sortOrder: [],
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
    selection: null,
    offset: 0,
    limit: DEFAULT_VIEW_PAGE_SIZE,
    totalCount: null,
    countStatus: "idle",
    countError: null,
  }
}

export function removeTab(states: TabStateMap, tabId: string): TabStateMap {
  if (!(tabId in states)) {
    return states
  }

  const { [tabId]: _deleted, ...nextStates } = states
  return nextStates
}

export function createQueryTable(): QueryTableState {
  return {
    status: "idle",
    dataAt: null,
    error: null,
    data: [],
    columns: [],
    visibility: {},
    sizing: {},
    pinning: {
      start: [],
      end: [],
    },
    selection: null,
  }
}

export function createQueryEditor(text = ""): QueryEditorState {
  return {
    ...createCodeView(),
    text,
  }
}

export function createCodeView(): CodeView {
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

export function createLog(): LogState {
  return {
    query: "",
    statuses: [],
    followTail: true,
    logs: [],
  }
}

export const tabsAtom = atom((get) => {
  const states = get(tabStatesAtom)
  return get(tabOrderAtom).map((id): TabMeta => {
    const { kind, label } = states[id]
    return { id, kind, label }
  })
})

export const activeQueryRunningAtom = atom(
  (get) => !!get(activeQueryTabAtom)?.execution,
)

export const activeTabIdAtom = atom((get) => get(activeIdAtom))

export const activeQueryTableAtom = atom((get) => getActiveQueryTab(get).table)

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
      const { visibility, sizing, pinning } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          table: {
            ...tab.table,
            visibility,
            sizing,
            pinning,
            selection:
              visibility !== tab.table.visibility ||
              pinning !== tab.table.pinning
                ? null
                : tab.table.selection,
          },
        },
      }
    })
  },
)

export const activeViewTableAtom = atom((get) => getActiveViewTab(get).table)

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
      const { visibility, sizing, pinning } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          table: {
            ...tab.table,
            visibility,
            sizing,
            pinning,
            selection:
              visibility !== tab.table.visibility ||
              pinning !== tab.table.pinning
                ? null
                : tab.table.selection,
          },
        },
      }
    })
  },
)

export const activeQueryEditorAtom = atom(
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
      updateViewTab(states, tabId, (current) => {
        const { cursor, selections, mainSelectionIndex, scroll, search } = view
        return {
          ...current,
          code: { cursor, selections, mainSelectionIndex, scroll, search },
        }
      }),
    )
  },
)

export const activeLogAtom = atom((get) => getActiveTab(get).log)

type CopyOptions = {
  format: "tsv" | "csv" | "json"
  headers: boolean
}

const copyStateAtom = atom<CopyOptions>({ format: "tsv", headers: false })

export const copyOptionsAtom = atom((get) => get(copyStateAtom))

export const setCopyOptionsAtom = atom(
  null,
  (_get, set, options: CopyOptions) => {
    set(copyStateAtom, options)
  },
)

export const setTableSelectionAtom = atom(
  null,
  (
    _get,
    set,
    { tabId, selection }: { tabId: string; selection: TableSelection | null },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (!tab || tab.table.selection === selection) return states
      const next: TabState =
        tab.kind === "query"
          ? { ...tab, table: { ...tab.table, selection } }
          : { ...tab, table: { ...tab.table, selection } }
      return { ...states, [tabId]: next }
    })
  },
)
