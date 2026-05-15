import { randomUUID } from "node:crypto"
import { ipcMain } from "electron"
import Store from "electron-store"
import conn from "../conn/main"
import type { Config, CreateConfig, UpdateConfig } from "."
import { CREATE, GET, LIST, REMOVE, UPDATE } from "."

const store = new Store<{
  configs: Record<string, Config>
}>({ name: "configs" })

function list(): Config[] {
  return Object.values(store.get("configs", {}))
}

function get(id: string): Config | undefined {
  return store.get(`configs.${id}`)
}

function create(input: CreateConfig): Config {
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

async function update(id: string, input: UpdateConfig): Promise<Config> {
  const current = get(id)
  if (!current) {
    throw new Error(`Config not found: ${id}`)
  }

  const updated: Config = {
    ...current,
    ...input,
    id,
    updatedAt: Date.now(),
  }

  store.set(`configs.${id}`, updated)
  await conn.disconnect(id).catch(() => undefined)
  return updated
}

async function remove(id: string): Promise<void> {
  store.delete(`configs.${id}`)
  await conn.remove(id).catch(() => undefined)
}

const config = {
  list,
  get,
  create,
  update,
  remove,
}

export default config

export function registerConfig(): void {
  ipcMain.handle(LIST, () => {
    return config.list()
  })
  ipcMain.handle(GET, (_e, id: string) => {
    return config.get(id)
  })
  ipcMain.handle(CREATE, (_e, input: CreateConfig) => {
    return config.create(input)
  })
  ipcMain.handle(UPDATE, (_e, id: string, input: UpdateConfig) => {
    return config.update(id, input)
  })
  ipcMain.handle(REMOVE, (_e, id: string) => {
    return config.remove(id)
  })
}
