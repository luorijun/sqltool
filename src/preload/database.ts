import type {
  Config,
  ConfigDraft,
  ConfigProfile,
  ConnSnapshot,
  FailureKind,
  QueryResult,
  SelectQuery,
  SelectResult,
  TableSource,
} from "@/core/database"
import type { Invoke } from "./invoke"

export const TEST = "conn:test"
export const CREATE = "conn:create"
export const UPDATE = "conn:update"
export const REMOVE = "conn:remove"
export const DISCONNECT = "conn:disconnect"
export const INSPECT = "conn:inspect"
export const QUERY = "conn:query"
export const SELECT = "conn:select"
export const OPEN_SESSION = "conn:open-session"
export const CLOSE_TAB = "conn:close-tab"
export const CANCEL = "conn:cancel"
export const SYNC = "conn:sync"

export type CreateConfig = ConfigDraft
export type UpdateConfig = Partial<ConfigDraft>
export type ConnResponse<T> = {
  snapshot: ConnSnapshot
} & ({ ok: true; value: T } | { ok: false; error: string; kind: FailureKind })

export function createDatabaseBridge(invoke: Invoke) {
  return {
    test: (profile: ConfigProfile) => invoke<void>(TEST, profile),
    sync: () => invoke<ConnSnapshot>(SYNC),
    create: (input: CreateConfig) =>
      invoke<ConnResponse<Config>>(CREATE, input),
    update: (id: string, input: UpdateConfig) =>
      invoke<ConnResponse<Config>>(UPDATE, id, input),
    remove: (id: string) => invoke<ConnResponse<void>>(REMOVE, id),
    disconnect: (configId: string) =>
      invoke<ConnResponse<boolean>>(DISCONNECT, configId),
    inspect: (configId: string, source?: TableSource, refresh = false) =>
      invoke<ConnResponse<void>>(INSPECT, configId, source, refresh),
    openSession: (configId: string, tabId: string) =>
      invoke<ConnResponse<string>>(OPEN_SESSION, configId, tabId),
    closeTab: (tabId: string) =>
      invoke<ConnResponse<boolean>>(CLOSE_TAB, tabId),
    cancel: (requestId: string) =>
      invoke<ConnResponse<void>>(CANCEL, requestId),
    query: (sessionId: string, requestId: string, sql: string) =>
      invoke<ConnResponse<QueryResult>>(QUERY, sessionId, requestId, sql),
    select: (
      configId: string,
      tabId: string,
      requestId: string,
      query: SelectQuery,
    ) =>
      invoke<ConnResponse<SelectResult>>(
        SELECT,
        configId,
        tabId,
        requestId,
        query,
      ),
  }
}
