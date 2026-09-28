export interface LogState extends LogView {
  logs: LogEntry[]
}

export interface LogView {
  query: string
  statuses: LogStatus[]
  followTail: boolean
}

export type LogStatus =
  | "success"
  | "error"
  | "running"
  | "cancelled"
  | "unknown"

export interface LogEntry {
  id: string
  status: LogStatus
  sql: string
  summary: string
  detail?: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
}
