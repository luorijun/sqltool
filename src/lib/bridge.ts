import type {
  Config,
  ConfigProfile,
  CreateConfig,
  UpdateConfig,
} from "./config"
import type { Connection, ConnState, QueryResult } from "./conn"
import type { SaveTextFileOptions } from "./serialize"

export interface MainBridge {
  config: {
    list(): Promise<Config[]>
    get(id: string): Promise<Config | undefined>
    create(input: CreateConfig): Promise<Config>
    update(id: string, input: UpdateConfig): Promise<Config>
    remove(id: string): Promise<void>
  }
  conn: {
    test(profile: ConfigProfile): Promise<void>
    list(): Promise<Connection[]>
    connect(configId: string): Promise<ConnState>
    disconnect(configId: string): Promise<ConnState>
    inspect(configId: string): Promise<ConnState>
    query(configId: string, sql: string): Promise<QueryResult>
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
