import type { Config } from "../config"

export type Tab = {
  id: string
  label: string
  config?: Config
  table: TabTableState
  editor: TabEditorState
  logger: TabLoggerState
}

export interface TabTableState {
  status: "idle" | "running" | "success" | "error"
  error: string | null
  dataAt: number | null

  data: Record<string, unknown>[]
  columns: { id: string; name: string }[]

  visibility: Record<string, boolean>
  sizing: Record<string, number>
  sorting: Array<{ id: string; desc: boolean }>
  pinning: { left: string[]; right: string[] }
  selected: { rowId: string; colId: string } | null
}

export interface TabEditorState {
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

export type TabLogStatus = "success" | "error" | "running"
export interface TabLoggerState {
  query: string
  statuses: TabLogStatus[]
  followTail: boolean
  logs: TabLogEntry[]
}

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
