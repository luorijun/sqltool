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

export interface QueryResultRow {
  [key: string]: unknown
}

export interface QueryResult {
  columns: string[]
  rows: QueryResultRow[]
  rowCount?: number
}
