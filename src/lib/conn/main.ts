import { randomUUID } from "node:crypto"
import { ipcMain } from "electron"
import Store from "electron-store"
import {
  CONNECT,
  type Config,
  type ConfigProfile,
  type Connection,
  CREATE,
  type CreateConfig,
  DISCONNECT,
  GET,
  INSPECT,
  LIST,
  QUERY,
  type QueryResult,
  REMOVE,
  TEST,
  UPDATE,
  type UpdateConfig,
} from "."
import { type ConnectionSession, connectDriver } from "./driver"

type ConnLock = {
  action: "connect" | "disconnect" | "inspect" | null
  queryCount: number
}

type ConnState = {
  session: ConnectionSession | null
  schema: Connection["schema"]
  error: Connection["error"]
}

const store = new Store<{
  configs: Record<string, Config>
}>({ name: "configs" })

const states: Record<string, ConnState | undefined> = {}
const locks: Record<string, ConnLock | undefined> = {}

function connection(config: Config): Connection {
  const state = states[config.id]

  return {
    config,
    connected: Boolean(state?.session),
    schema: state?.schema ?? null,
    error: state?.error ?? null,
  }
}

async function test(profile: ConfigProfile): Promise<void> {
  const session = await connectDriver(profile)

  try {
    await session.close()
  } catch {
    // ignore close failure after a successful test connection
  }
}

function list(): Connection[] {
  return Object.values(store.get("configs", {})).map((config) =>
    connection(config),
  )
}

function get(id: string): Connection | undefined {
  const config = store.get(`configs.${id}`)
  return config ? connection(config) : undefined
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
  const current = store.get(`configs.${id}`)
  if (!current) {
    throw new Error("连接不存在或已删除")
  }

  if (states[id]?.session) {
    throw new Error("连接尚未关闭，请先断开连接")
  }

  const lock = locks[id]
  if (lock?.action || lock?.queryCount) {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  const updated: Config = {
    ...current,
    ...input,
    id,
    updatedAt: Date.now(),
  }

  delete states[id]
  store.set(`configs.${id}`, updated)
  return updated
}

async function remove(id: string): Promise<void> {
  if (states[id]?.session) {
    throw new Error("连接尚未关闭，请先断开连接")
  }

  const lock = locks[id]
  if (lock?.action || lock?.queryCount) {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  delete states[id]
  delete locks[id]
  store.delete(`configs.${id}`)
}

async function connect(configId: string): Promise<Connection> {
  const config = store.get(`configs.${configId}`)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  if (states[configId]?.session) {
    return connection(config)
  }

  const lock = locks[configId]
  if (lock?.action || lock?.queryCount) {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  locks[configId] = {
    action: "connect",
    queryCount: 0,
  }

  try {
    states[configId] = {
      session: await connectDriver(config),
      schema: null,
      error: null,
    }
  } catch (error) {
    states[configId] = {
      session: null,
      schema: null,
      error: error instanceof Error ? error.message : "连接失败",
    }
  } finally {
    delete locks[configId]
  }
  return connection(config)
}

async function disconnect(configId: string): Promise<Connection> {
  const config = store.get(`configs.${configId}`)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  const lock = locks[configId]
  if (lock?.action || lock?.queryCount) {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  const state = states[configId]
  const session = state?.session
  if (!session) {
    return connection(config)
  }

  locks[configId] = {
    action: "disconnect",
    queryCount: 0,
  }

  try {
    await session.close()
    state.session = null
    state.error = null
  } finally {
    delete locks[configId]
  }
  return connection(config)
}

async function inspect(configId: string): Promise<Connection> {
  const config = store.get(`configs.${configId}`)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  const lock = locks[configId]
  if (lock?.action) {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  const state = states[configId]
  const session = state?.session
  if (!session) {
    throw new Error("连接尚未建立")
  }

  if (lock) {
    lock.action = "inspect"
  } else {
    locks[configId] = {
      action: "inspect",
      queryCount: 0,
    }
  }

  try {
    const schema = await session.inspect()
    state.schema = schema
    state.error = null
  } catch (error) {
    state.error = error instanceof Error ? error.message : "获取模式信息失败"
  } finally {
    const currentLock = locks[configId]
    if (!currentLock || currentLock.queryCount === 0) {
      delete locks[configId]
    } else {
      currentLock.action = null
    }
  }
  return connection(config)
}

async function query(configId: string, sql: string): Promise<QueryResult> {
  if (!store.get(`configs.${configId}`)) {
    throw new Error("连接不存在或已删除")
  }

  const lock = locks[configId]
  if (lock?.action === "connect" || lock?.action === "disconnect") {
    throw new Error("当前连接正在执行其他操作，请稍后再试")
  }

  const session = states[configId]?.session
  if (!session) {
    throw new Error("连接尚未建立")
  }

  if (lock) {
    lock.queryCount += 1
  } else {
    locks[configId] = {
      action: null,
      queryCount: 1,
    }
  }

  try {
    return await session.query(sql)
  } finally {
    const currentLock = locks[configId]
    if (currentLock) {
      currentLock.queryCount = Math.max(0, currentLock.queryCount - 1)
      if (!currentLock.action && currentLock.queryCount === 0) {
        delete locks[configId]
      }
    }
  }
}

export function registerConn(): void {
  ipcMain.handle(TEST, (_e, profile: ConfigProfile) => {
    return test(profile)
  })
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
    return update(id, input)
  })
  ipcMain.handle(REMOVE, (_e, id: string) => {
    return remove(id)
  })
  ipcMain.handle(CONNECT, (_e, configId: string) => {
    return connect(configId)
  })
  ipcMain.handle(DISCONNECT, (_e, configId: string) => {
    return disconnect(configId)
  })
  ipcMain.handle(INSPECT, (_e, configId: string) => {
    return inspect(configId)
  })
  ipcMain.handle(QUERY, (_e, configId: string, sql: string) => {
    return query(configId, sql)
  })
}
