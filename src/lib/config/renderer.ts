import type { Config, CreateConfig, UpdateConfig } from "./index"

const config = {
  list(): Promise<Config[]> {
    return window.main.config.list()
  },
  get(id: string): Promise<Config | undefined> {
    return window.main.config.get(id)
  },
  create(input: CreateConfig): Promise<Config> {
    return window.main.config.create(input)
  },
  update(id: string, input: UpdateConfig): Promise<Config> {
    return window.main.config.update(id, input)
  },
  delete(id: string): Promise<void> {
    return window.main.config.delete(id)
  },
}

export default config
