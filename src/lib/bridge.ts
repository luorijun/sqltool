import type { Config, CreateConfig, UpdateConfig } from "./config/index"
import type { DbSchema } from "./conn/index"

export interface MainBridge {
  config: {
    list(): Promise<Config[]>
    get(id: string): Promise<Config | undefined>
    create(input: CreateConfig): Promise<Config>
    update(id: string, input: UpdateConfig): Promise<Config>
    delete(id: string): Promise<void>
  }
  conn: {
    inspect(config: Config): Promise<DbSchema[]>
  }
}

declare global {
  interface Window {
    main: MainBridge
  }
}
