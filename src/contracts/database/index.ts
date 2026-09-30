export const TEST = "conn:test"
export const CREATE = "conn:create"
export const UPDATE = "conn:update"
export const REMOVE = "conn:remove"
export const CONNECT = "conn:connect"
export const DISCONNECT = "conn:disconnect"
export const INSPECT = "conn:inspect"
export const QUERY = "conn:query"
export const SELECT = "conn:select"
export const OPEN_SESSION = "conn:open-session"
export const CLOSE_TAB = "conn:close-tab"
export const CANCEL = "conn:cancel"
export const SYNC = "conn:sync"

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

export type CreateConfig = ConfigProfile & {
  name?: string
}

export type UpdateConfig = Partial<CreateConfig>

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

export type ConnResponse<T> = {
  snapshot: ConnSnapshot
} & ({ ok: true; value: T } | { ok: false; error: string; kind: FailureKind })

export interface DatabaseApi {
  test(profile: ConfigProfile): Promise<void>
  sync(): Promise<ConnSnapshot>
  create(input: CreateConfig): Promise<ConnResponse<Config>>
  update(id: string, input: UpdateConfig): Promise<ConnResponse<Config>>
  remove(id: string): Promise<ConnResponse<void>>
  connect(configId: string): Promise<ConnResponse<void>>
  disconnect(configId: string): Promise<ConnResponse<boolean>>
  inspect(configId: string, source?: TableSource): Promise<ConnResponse<void>>
  openSession(configId: string, tabId: string): Promise<ConnResponse<string>>
  closeTab(tabId: string): Promise<ConnResponse<boolean>>
  cancel(requestId: string): Promise<ConnResponse<void>>
  query(
    sessionId: string,
    requestId: string,
    sql: string,
  ): Promise<ConnResponse<QueryResult>>
  select(
    configId: string,
    tabId: string,
    requestId: string,
    query: SelectQuery,
  ): Promise<ConnResponse<SelectResult>>
}
