import type { Config } from "@/core/database"

export interface ConfigStore {
  list(): Config[]
  get(id: string): Config | undefined
  set(config: Config): void
  remove(id: string): void
}

export function createConfigStore(
  read: () => Record<string, Config>,
  write: (configs: Record<string, Config>) => void,
): ConfigStore {
  return {
    list: () => Object.values(read()),
    get: (id) => read()[id],
    set: (config) => write({ ...read(), [config.id]: config }),
    remove(id) {
      const configs = { ...read() }
      delete configs[id]
      write(configs)
    },
  }
}
