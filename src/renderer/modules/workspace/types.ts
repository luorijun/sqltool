import type { QueryResultColumn, SelectOrderBy } from "@/contracts/database"

export type TabKind = "query" | "view"

export interface TabMeta {
  id: string
  kind: TabKind
  label: string
}

export interface QueryTabState extends TabMeta {
  kind: "query"
  configId?: string
  sessionId?: string
  execution?: { requestId: string; cancelRequested: boolean }
  closing?: boolean
  table: QueryTabTableState
  editor: QueryTabEditorState
  logger: TabLoggerState
}

export interface ViewTabState extends TabMeta {
  kind: "view"
  configId: string
  closing?: boolean
  cancelling?: boolean
  source: {
    schema: string
    table: string
  }
  table: ViewTabTableState
  code: CodeView
  logger: TabLoggerState
}

export type TabState = QueryTabState | ViewTabState

export interface QueryTabTableState {
  status: "idle" | "success" | "error"
  error: string | null
  dataAt: number | null
  sessionId?: string

  data: Record<string, unknown>[]
  columns: QueryResultColumn[]

  visibility: Record<string, boolean>
  sizing: Record<string, number>
  pinning: { start: string[]; end: string[] }
  selection: TableSelection | null
}

export interface QueryTabEditorState extends CodeView {
  text: string
}

export interface CodeView {
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

export interface TabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

export interface ViewTabTableState {
  sort: SelectOrderBy[]
  sortOrder: string[]
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null
  sql: string
  requestId?: string
  countRequestId?: string
  generation?: number
  data: Record<string, unknown>[]
  columns: QueryResultColumn[]
  visibility: Record<string, boolean>
  sizing: Record<string, number>
  pinning: { start: string[]; end: string[] }
  selection: TableSelection | null
  offset: number
  limit: number
  totalCount: number | null
  countStatus: "idle" | "running" | "success" | "error"
  countError: string | null
}

export type TabLogStatus =
  | "success"
  | "error"
  | "running"
  | "cancelled"
  | "unknown"

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

export type TableLayout = Pick<
  QueryTabTableState,
  "visibility" | "sizing" | "pinning"
>

export type EditorView = QueryTabEditorState
export type LogView = Omit<TabLoggerState, "logs">

export interface TableSelection {
  rows: number[]
  columns: string[]
  anchor: { row: number; col: string }
  active: { row: number; col: string }
  toggle: {
    rows: number[]
    columns: string[]
    mode: "cells" | "rows" | "columns" | "all"
    operation: "add" | "remove"
  } | null
}
