import type {
  Config,
  ConfigProfile,
  ConnResponse,
  ConnSnapshot,
  CreateConfig,
  QueryResult,
  SelectQuery,
  SelectResult,
  UpdateConfig,
} from "./conn"
import type { SaveTextFileOptions } from "./serialize"

export interface MainBridge {
  conn: {
    test(profile: ConfigProfile): Promise<void>
    list(): Promise<ConnSnapshot>
    get(id: string): Promise<ConnSnapshot>
    sync(): Promise<ConnSnapshot>
    create(input: CreateConfig): Promise<ConnResponse<Config>>
    update(id: string, input: UpdateConfig): Promise<ConnResponse<Config>>
    remove(id: string): Promise<ConnResponse<void>>
    connect(configId: string): Promise<ConnResponse<void>>
    disconnect(configId: string): Promise<ConnResponse<boolean>>
    inspect(configId: string): Promise<ConnResponse<void>>
    openSession(configId: string, tabId: string): Promise<ConnResponse<string>>
    closeSession(sessionId: string): Promise<ConnResponse<boolean>>
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
  serialize: {
    writeClipboardText(text: string): Promise<void>
    saveTextFile(options: SaveTextFileOptions): Promise<string | null>
  }
}

declare global {
  interface Window {
    main: MainBridge
  }
}
