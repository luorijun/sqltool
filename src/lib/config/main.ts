import { randomUUID } from "node:crypto"
import { ipcMain } from "electron"
import Store from "electron-store"
import type { Config, CreateConfig, UpdateConfig } from "."
import { CREATE, DELETE, GET, LIST, UPDATE } from "."

type ConfigStore = {
  configs: Record<string, Config>
}

let _store: Store<ConfigStore> | null = null

function store(): Store<ConfigStore> {
  if (!_store) {
    _store = new Store<ConfigStore>({
      name: "configs",
    })
  }
  return _store
}

function configs(): Record<string, Config> {
  return store().get("configs", {})
}

function list(): Config[] {
  return Object.values(configs())
}

function get(id: string): Config | undefined {
  return configs()[id]
}

function create(input: CreateConfig): Config {
  const now = Date.now()
  const config: Config = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store().set(`configs.${config.id}`, config)
  return config
}

function updateConfig(id: string, input: UpdateConfig): Config {
  const existing = get(id)
  if (!existing) {
    throw new Error(`Config not found: ${id}`)
  }

  const updated: Config = {
    ...existing,
    ...input,
    id,
    updatedAt: Date.now(),
  }
  store().set(`configs.${id}`, updated)
  return updated
}

function deleteConfig(id: string): void {
  const _configs = configs()
  delete _configs[id]
  store().set("configs", configs)
}

export function registerHandlers(): void {
  ipcMain.handle(LIST, () => {
    return list()
  })
  ipcMain.handle(GET, (_e, id: string) => {
    return get(id)
  })
  ipcMain.handle(CREATE, (_e, input: CreateConfig) => {
    return create(input)
  })
  ipcMain.handle(UPDATE, (_e, id: string, input: UpdateConfig) => {
    return updateConfig(id, input)
  })
  ipcMain.handle(DELETE, (_e, id: string) => {
    return deleteConfig(id)
  })
}
