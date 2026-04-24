import type { Config, CreateConfig, UpdateConfig } from "./config"
import type { DbSchema, QueryResult } from "./conn"
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
    inspect(config: Config): Promise<DbSchema[]>
    query(config: Config, sql: string): Promise<QueryResult>
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
