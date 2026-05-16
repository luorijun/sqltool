export const TEST = "conn:test"
export const LIST = "conn:list"
export const GET = "conn:get"
export const CREATE = "conn:create"
export const UPDATE = "conn:update"
export const REMOVE = "conn:remove"
export const CONNECT = "conn:connect"
export const DISCONNECT = "conn:disconnect"
export const INSPECT = "conn:inspect"
export const QUERY = "conn:query"

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
}

export type QueryResultRow = unknown[]

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: QueryResultRow[]
  rowCount?: number
}

export interface Connection {
  config: Config
  connected: boolean
  schema: DbSchema[] | null
  error: string | null
}
