import type {
  Config,
  ConfigProfile,
  DbSchema,
  QueryColumnTypeFamily,
  QueryResult,
  QueryResultColumn,
  SelectQuery,
  SelectResult,
  TableSource,
} from "@/contracts/database"

export interface TypeRef {
  oid: number
  modifier: number
}
export interface ColumnType {
  dbType: string
  typeFamily: QueryColumnTypeFamily
}
export type DriverColumn = QueryResultColumn & { typeRef?: TypeRef }
export type DriverResult = Omit<QueryResult, "columns"> & {
  columns: DriverColumn[]
}

export interface ConnectionSession {
  prepareMetadata?: () => Promise<void>
  inspect(source?: TableSource): Promise<DbSchema[]>
  types?: (refs: TypeRef[]) => Promise<Array<ColumnType | null>>
  query(sql: string): Promise<DriverResult>
  select(
    query: SelectQuery,
  ): Promise<Omit<SelectResult, "result"> & { result: DriverResult }>
  close(): Promise<void>
  destroy(): void
  cancel(): Promise<void>
  onFailure(listener: (error: Error) => void): () => void
}

export type Connect = (profile: ConfigProfile) => Promise<ConnectionSession>
export type Confirm = (
  owner: number,
  message: string,
  detail: string,
  force?: boolean,
) => Promise<boolean>
export interface ConfigStore {
  list(): Config[]
  get(id: string): Config | undefined
  set(config: Config): void
  remove(id: string): void
}
export interface DatabaseOptions {
  store: ConfigStore
  connect: Connect
  confirm: Confirm
}
