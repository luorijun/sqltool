import type { Config, DbDriver } from "@/lib/config"
import type { QueryResult } from "@/lib/conn"

export interface Tab {
  id: string
  label: string
  dirty?: boolean
}

export interface TabData {
  connection?: Config
  sql: string
  result: TabResultState
  logs: TabLogEntry[]
  editor: TabEditorData
  table: TabTableData
}

// ====================
// table
// ====================

export interface TabTableData {
  sorting: TabTableSorting[]
  columnVisibility: Record<string, boolean>
  columnSizing: Record<string, number>
  columnPinning: {
    left: string[]
    right: string[]
  }
  activeCell: TabTableActiveCell | null
}

export interface TabTableActiveCell {
  rowId: string
  columnId: string
}

export interface TabTableSorting {
  id: string
  desc: boolean
}

// ====================
// editor
// ====================

export interface TabEditorData {
  cursor: TabEditorCursor
  selections: TabEditorSelection[]
  mainSelectionIndex: number
  scroll: TabEditorScroll
  search: TabEditorSearch
  dialectOverride?: DbDriver
}

export interface TabEditorCursor {
  line: number
  col: number
}

export interface TabEditorSelection {
  anchor: number
  head: number
}

export interface TabEditorScroll {
  top: number
  left: number
}

export interface TabEditorSearch {
  query: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
  open: boolean
}

// ====================
// logs
// ====================

export interface TabLogEntry {
  id: string
  time: string
  status: TabLogStatus
  sql: string
  detail?: string
  duration?: number
}

export type TabLogStatus = "success" | "error" | "info" | "running"

// ====================
// others
// ====================

export interface TabResultState {
  executedSql: string
  executed: boolean
  running: boolean
  columns: QueryResult["columns"]
  rows: QueryResult["rows"]
  rowCount: number
  durationMs: number
  executedAt: string
  error?: string
}

export interface AddTabOptions {
  label?: string
  sql?: string
  connection?: Config
  autoRun?: boolean
}
