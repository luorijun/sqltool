export const TEST = "conn:test"
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
