import { randomUUID } from "node:crypto"
import { ipcMain } from "electron"
import Store from "electron-store"
import type { Config, CreateConfig, UpdateConfig } from "."
import { CREATE, GET, LIST, REMOVE, UPDATE } from "."

type ConfigStore = {
  configs: Record<string, Config>
}

export interface RegisterConfigHandlersOptions {
  afterUpdate?: (id: string, config: Config) => void | Promise<void>
  afterRemove?: (id: string) => void | Promise<void>
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

async function runHandler(
  handler: (() => void | Promise<void>) | undefined,
): Promise<void> {
  if (!handler) {
    return
  }

  await Promise.resolve(handler()).catch(() => undefined)
}

export function listConnectionConfigs(): Config[] {
  return Object.values(configs())
}

export function getConnectionConfig(id: string): Config | undefined {
  return configs()[id]
}

export function createConnectionConfig(input: CreateConfig): Config {
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

export function updateConnectionConfig(
  id: string,
  input: UpdateConfig,
): Config {
  const existing = getConnectionConfig(id)
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

export function removeConnectionConfig(id: string): void {
  const nextConfigs = configs()
  delete nextConfigs[id]
  store().set("configs", nextConfigs)
}

export function registerHandlers(
  options: RegisterConfigHandlersOptions = {},
): void {
  ipcMain.handle(LIST, () => {
    return listConnectionConfigs()
  })
  ipcMain.handle(GET, (_e, id: string) => {
    return getConnectionConfig(id)
  })
  ipcMain.handle(CREATE, (_e, input: CreateConfig) => {
    return createConnectionConfig(input)
  })
  ipcMain.handle(UPDATE, async (_e, id: string, input: UpdateConfig) => {
    const config = updateConnectionConfig(id, input)
    await runHandler(() => options.afterUpdate?.(id, config))
    return config
  })
  ipcMain.handle(REMOVE, async (_e, id: string) => {
    removeConnectionConfig(id)
    await runHandler(() => options.afterRemove?.(id))
  })
}
