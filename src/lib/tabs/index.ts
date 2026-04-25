import type { QueryResult } from "@/lib/conn"

export interface TabEditorState {
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

export interface TabTableState {
  sorting: Array<{
    id: string
    desc: boolean
  }>
  columnVisibility: Record<string, boolean>
  columnSizing: Record<string, number>
  columnPinning: {
    left: string[]
    right: string[]
  }
  activeCell: {
    rowId: string
    columnId: string
  } | null
}

export interface TabLogViewState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
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

export type TabResultStatus = "idle" | "running" | "success" | "error"

export interface TabResultState {
  status: TabResultStatus
  lastRunSql: string
  lastRunAt: number | null
  durationMs: number | null
  columns: QueryResult["columns"]
  rows: QueryResult["rows"]
  rowCount: number
  error: string | null
}
