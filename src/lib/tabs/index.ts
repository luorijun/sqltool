import type { QueryResultColumn } from "@/lib/conn"

export type TabKind = "query" | "view"

export interface TabMeta {
  id: string
  kind: TabKind
  label: string
}

export interface QueryTabState {
  id: string
  kind: "query"
  label: string
  configId?: string
  table: QueryTabTableState
  editor: QueryTabEditorState
  logger: QueryTabLoggerState
}

export interface ViewTabState {
  id: string
  kind: "view"
  label: string
  configId: string
  source: {
    schema: string
    table: string
  }
  table: ViewTabTableState
  code: ViewTabCodeState
  logger: ViewTabLoggerState
}

export type TabState = QueryTabState | ViewTabState

export interface QueryTabTableState {
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null

  data: Record<string, unknown>[]
  columns: QueryResultColumn[]

  visibility: Record<string, boolean>
  sizing: Record<string, number>
  sorting: Array<{ id: string; desc: boolean }>
  pinning: { left: string[]; right: string[] }
  selected: { rowId: string; colId: string } | null
}

export interface QueryTabEditorState {
  status: "idle" | "running"
  text: string
  cursor: {
    line: number
    col: number
  }
  selections: Array<{
    anchor: number
    head: number
  }>
  mainSelectionIndex: number
  scroll: {
    top: number
    left: number
  }
  search: {
    query: string
    replace: string
    caseSensitive: boolean
    wholeWord: boolean
    regexp: boolean
    open: boolean
  }
}

export interface QueryTabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

export interface ViewTabTableState {
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null
  data: Record<string, unknown>[]
  columns: QueryResultColumn[]
  visibleColumns: string[]
  columnOrder: string[]
  filters: Array<{
    columnId: string
    operator: string
    value: unknown
  }>
  sorting: Array<{ id: string; desc: boolean }>
  sizing: Record<string, number>
  pinning: { left: string[]; right: string[] }
  selected: { rowId: string; colId: string } | null
  limit: number
  offset: number
}

export interface ViewTabCodeState {
  sql: string
}

export interface ViewTabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

export type TabLogStatus = "success" | "error" | "running"

export interface TabLogEntry {
  id: string
  status: TabLogStatus
  sql: string
  summary: string
  detail?: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
}
