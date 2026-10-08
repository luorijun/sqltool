export type DbDriver = "postgres" | "mysql"

export type SshPasswordAuth = {
  type: "password"
  password: string
}

export type SshPrivateKeyAuth = {
  type: "privateKey"
  passphrase?: string
}

export type SshAuth = SshPasswordAuth | SshPrivateKeyAuth

export type SshConfig = {
  host: string
  port: string
  username: string
  auth: SshAuth
}

export type ConfigProfile = {
  driver: DbDriver
  host: string
  port: string
  username: string
  password: string
  database: string
  ssh?: SshConfig
}

export type Config = ConfigProfile & {
  id: string
  name?: string
  createdAt: number
  updatedAt: number
}

export type ConfigDraft = ConfigProfile & {
  name?: string
}

export interface DbColumn {
  name: string
  type: string
  pk?: boolean
  fk?: boolean
}

export interface DbTable {
  name: string
  rowCount?: number
  columns: DbColumn[]
}

export interface DbView {
  name: string
}

export interface DbFunction {
  name: string
}

export interface DbSchema {
  name: string
  tables: DbTable[]
  views: DbView[]
  functions: DbFunction[]
}

export interface QueryResultColumn {
  id: string
  name: string
  driver?: DbDriver
  dbType?: string
  typeCode?: number | string
  typeFamily: QueryColumnTypeFamily
  schema?: string
  table?: string
  sourceColumn?: string
  sourceTableId?: number
  sourceColumnId?: number
  nullable?: boolean
  unsigned?: boolean
  primaryKey?: boolean
  autoIncrement?: boolean
  format?: string
}

export type QueryColumnTypeFamily =
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "json"
  | "array"
  | "binary"
  | "string"
  | "uuid"
  | "unknown"

export type QueryResultRow = unknown[]

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: QueryResultRow[]
  rowCount?: number
}

export interface TableSource {
  schema: string
  table: string
}

export type SelectOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "notLike"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull"
  | "and"
  | "or"

export interface SelectCondition {
  column?: string
  operator: SelectOperator
  value?: unknown
  conditions?: SelectCondition[]
}

export type SelectField =
  | string
  | {
      aggregate: "count"
      column?: string
      alias?: string
    }

export interface SelectOrderBy {
  column: string
  direction?: "asc" | "desc"
}

export interface SelectQuery {
  from: TableSource
  select?: SelectField[]
  where?: SelectCondition
  orderBy?: SelectOrderBy[]
  limit?: number
  offset?: number
}

export interface SelectResult {
  result: QueryResult
  executedSql: string
}

export interface Connection {
  config: Config
  connected: boolean
  schema: DbSchema[] | null
  error: string | null
  sessionCount: number
  failedCount: number
  generation: number
}

export type SessionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "closing"
  | "closed"
  | "failed"
export type TaskStatus = "queued" | "connecting" | "running" | "cancelling"
export type FailureKind = "error" | "cancelled" | "unknown"

export interface SessionSnapshot {
  id: string
  configId: string
  tabId?: string
  kind: "sql" | "schema" | "browse"
  status: SessionStatus
  used: boolean
  error: string | null
}

export interface TaskSnapshot {
  id: string
  sessionId: string
  tabId?: string
  status: TaskStatus
}

export interface ConnSnapshot {
  version: number
  connections: Connection[]
  sessions: SessionSnapshot[]
  tasks: TaskSnapshot[]
}

export class ConnError extends Error {
  readonly kind: FailureKind

  constructor(message: string, kind: FailureKind = "error") {
    super(message)
    this.kind = kind
  }
}
