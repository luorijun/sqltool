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
  configId?: string
  sessionId?: string
  requestId?: string
  phase?: "connecting" | "running" | "cancelling"
  cancelRequested?: boolean
  closing?: boolean
  table: QueryTabTableState
  editor: QueryTabEditorState
  logger: TabLoggerState
}

export interface ViewTabState {
  id: string
  kind: "view"
  configId: string
  closing?: boolean
  source: {
    schema: string
    table: string
  }
  table: ViewTabTableState
  logger: TabLoggerState
}

export type TabState = QueryTabState | ViewTabState

export interface QueryTabTableState {
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null
  sessionId?: string

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

export interface TabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

export interface ViewTabTableState {
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null
  requestId?: string
  countRequestId?: string
  generation?: number
  data: Record<string, unknown>[]
  columns: QueryResultColumn[]
  visibility: Record<string, boolean>
  sizing: Record<string, number>
  pinning: { left: string[]; right: string[] }
  selected: { rowId: string; colId: string } | null
  pageIndex: number
  pageSize: number
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
