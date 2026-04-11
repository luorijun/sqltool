import { randomUUID } from "node:crypto"
import Store from "electron-store"

export type DbDriver = "postgres" | "mysql" | "sqlite"

export type Config = {
  id: string
  name?: string
  driver: DbDriver
  host: string
  port: string
  username: string
  password: string
  database: string
  createdAt: number
  updatedAt: number
}

export type CreateConfig = Omit<Config, "id" | "createdAt" | "updatedAt">
export type UpdateConfig = Partial<CreateConfig>

const store = new Store<{ configs: Record<string, Config> }>({
  name: "configs",
})

export function listConfigs(): Config[] {
  const configs = store.get("configs")
  return Object.values(configs)
}

export function getConfig(id: string): Config | undefined {
  const configs = store.get("configs")
  return configs[id]
}

export function createConfig(input: CreateConfig): Config {
  const now = Date.now()
  const config: Config = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  store.set(`configs.${config.id}`, config)
  return config
}

export function updateConfig(id: string, input: UpdateConfig): Config {
  const configs = store.get("configs")
  const existing = configs[id]
  if (!existing) {
    throw new Error(`Config not found: ${id}`)
  }
  const updated: Config = {
    ...existing,
    ...input,
    id,
    updatedAt: Date.now(),
  }
  store.set(`configs.${id}`, updated)
  return updated
}

export function deleteConfig(id: string): void {
  const configs = store.get("configs")
  delete configs[id]
  store.set("configs", configs)
}
