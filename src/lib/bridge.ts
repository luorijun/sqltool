import type {
  Config,
  ConfigProfile,
  Connection,
  CreateConfig,
  QueryResult,
  UpdateConfig,
} from "./conn"
import type { SaveTextFileOptions } from "./serialize"

export interface MainBridge {
  conn: {
    test(profile: ConfigProfile): Promise<void>
    list(): Promise<Connection[]>
    get(id: string): Promise<Connection | undefined>
    create(input: CreateConfig): Promise<Config>
    update(id: string, input: UpdateConfig): Promise<Config>
    remove(id: string): Promise<void>
    connect(configId: string): Promise<Connection>
    disconnect(configId: string): Promise<Connection>
    inspect(configId: string): Promise<Connection>
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
