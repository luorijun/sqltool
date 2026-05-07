import type { Config } from "../config"

export const TEST = "conn:test"
export const LIST = "conn:list"
export const CONNECT = "conn:connect"
export const DISCONNECT = "conn:disconnect"
export const INSPECT = "conn:inspect"
export const QUERY = "conn:query"

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

export interface ConnectionState {
  configId: string
  status: "idle" | "connecting" | "connected" | "error"
  schemaStatus: "idle" | "loading" | "success" | "error"
  schema: DbSchema[] | null
  error: string | null
  lastConnectedAt: number | null
  lastSchemaAt: number | null
}

export interface ConnectionEntry {
  config: Config
  state: ConnectionState
}

export function createConnectionState(configId: string): ConnectionState {
  return {
    configId,
    status: "idle",
    schemaStatus: "idle",
    schema: null,
    error: null,
    lastConnectedAt: null,
    lastSchemaAt: null,
  }
}
