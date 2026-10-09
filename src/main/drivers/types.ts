import type {
  ConfigProfile,
  DbSchema,
  QueryResult,
  QueryResultColumn,
  TableSource,
} from "@/core/database"

export interface PostgresTypeRef {
  driver: "postgres"
  oid: number
  modifier: number
}
export interface MySqlTypeRef {
  driver: "mysql"
  code?: number
  flags: number
  charset?: number
  length?: number
  decimals: number
  extendedType?: string
  extendedFormat?: string
}
export type TypeRef = PostgresTypeRef | MySqlTypeRef
export type ColumnType = Pick<QueryResultColumn, "dbType" | "typeFamily">
export type DriverColumn = QueryResultColumn & { typeRef?: TypeRef }
export type DriverResult = Omit<QueryResult, "columns"> & {
  columns: DriverColumn[]
}

export type Transaction = "idle" | "active" | "failed" | "unknown"
export interface TableDefinition {
  source: TableSource
  columns: Array<{
    name: string
    key: boolean
    generated: boolean
    id?: number
  }>
}
export interface ConnectionSession {
  transaction(): Promise<Transaction>
  prepareMetadata?: () => Promise<void>
  inspect(source?: TableSource): Promise<DbSchema[]>
  types?: (refs: PostgresTypeRef[]) => Promise<Array<ColumnType | null>>
  charsets?: () => Promise<Map<number, number>>
  describe?: (
    columns: DriverColumn[],
    source?: TableSource,
  ) => Promise<TableDefinition | null>
  query(sql: string, params?: unknown[]): Promise<DriverResult>
  close(): Promise<void>
  destroy(): void
  cancel(): Promise<void>
  onFailure(listener: (error: Error) => void): () => void
}

export type Connect = (profile: ConfigProfile) => Promise<ConnectionSession>
