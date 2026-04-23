import type { Config } from "@/lib/config"
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
  visible: Record<string, boolean>
  sizing: Record<string, number>
  pinning: {
    left: string[]
    right: string[]
  }
  rowSelection: Record<string, boolean>
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
  scroll: TabEditorScroll
  search: TabEditorSearch
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
