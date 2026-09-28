import type {
  Config,
  ConfigProfile,
  DbSchema,
  QueryResult,
  SelectQuery,
  SelectResult,
} from "@/contracts/database"
export interface ConnectionSession {
  inspect(): Promise<DbSchema[]>
  query(sql: string): Promise<QueryResult>
  select(query: SelectQuery): Promise<SelectResult>
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
