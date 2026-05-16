import { randomUUID } from "node:crypto"
import { ipcMain } from "electron"
import Store from "electron-store"
import {
  CONNECT,
  type Config,
  type ConfigProfile,
  type Connection,
  type ConnState,
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

type Runtime = {
  config: ConfigProfile
  session: Promise<ConnectionSession> | null
  state: ConnState
}

const store = new Store<{
  configs: Record<string, Config>
}>({ name: "configs" })

const connections = new Map<string, Runtime>()

function createState(): ConnState {
  return {
    status: "idle",
    schemaStatus: "idle",
    schema: null,
    error: null,
  }
}

function updateState(
  runtime: Runtime,
  nextConnection: Partial<ConnState>,
): ConnState {
  runtime.state = {
    ...runtime.state,
    ...nextConnection,
  }
  return runtime.state
}

async function withSession<T>(
  profile: ConfigProfile,
  run: (session: ConnectionSession) => Promise<T>,
): Promise<T> {
  const session = await connectDriver(profile)

  try {
    return await run(session)
  } finally {
    await session.close().catch(() => undefined)
  }
}

async function test(profile: ConfigProfile): Promise<void> {
  await withSession(profile, async () => undefined)
}

function list(): Connection[] {
  return Object.values(store.get("configs", {})).map((entry) => ({
    config: entry,
    state: connections.get(entry.id)?.state ?? createState(),
  }))
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
  const current = store.get(`configs.${id}`)
  if (!current) {
    throw new Error("连接不存在或已删除")
  }

  const updated: Config = {
    ...current,
    ...input,
    id,
    updatedAt: Date.now(),
  }

  store.set(`configs.${id}`, updated)

  await disconnect(id).catch(() => undefined)
  return updated
}

async function remove(id: string): Promise<void> {
  await disconnect(id).catch(() => undefined)
  connections.delete(id)
  store.delete(`configs.${id}`)
}

async function connect(configId: string): Promise<ConnState> {
  const config = store.get(`configs.${configId}`)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  const runtime = connections.get(configId) ?? {
    config,
    session: null,
    state: createState(),
  }
  runtime.config = config
  connections.set(configId, runtime)

  updateState(runtime, {
    status: "connecting",
    schemaStatus: "loading",
    error: null,
  })

  const session =
    runtime.session ??
    connectDriver(runtime.config).catch((error) => {
      if (runtime.session === session) {
        runtime.session = null
      }
      throw error
    })
  runtime.session = session

  try {
    const activeSession = await session
    const schema = await activeSession.inspect()
    if (runtime.session !== session) {
      return runtime.state
    }

    return updateState(runtime, {
      status: "connected",
      schemaStatus: "success",
      schema,
      error: null,
    })
  } catch (error) {
    if (runtime.session !== session) {
      return runtime.state
    }

    await disconnect(configId)
    return updateState(runtime, {
      status: "error",
      schemaStatus: "error",
      schema: null,
      error: error instanceof Error ? error.message : "连接失败",
    })
  }
}

async function disconnect(configId: string): Promise<ConnState> {
  const runtime = connections.get(configId)
  if (!runtime) {
    return createState()
  }

  const session = runtime.session
  runtime.session = null

  if (!session) {
    runtime.state = createState()
    return runtime.state
  }

  const activeSession = await session.catch(() => null)
  await activeSession?.close().catch(() => undefined)

  if (runtime.session) {
    return runtime.state
  }

  runtime.state = createState()
  return runtime.state
}

async function inspect(configId: string): Promise<ConnState> {
  if (!store.get(`configs.${configId}`)) {
    throw new Error("连接不存在或已删除")
  }

  const runtime = connections.get(configId)
  const session = runtime?.session
  if (!runtime || !session) {
    throw new Error("连接尚未建立")
  }

  updateState(runtime, {
    schemaStatus: "loading",
    error: null,
  })

  try {
    const schema = await (await session).inspect()
    if (runtime.session !== session) {
      return runtime.state
    }

    return updateState(runtime, {
      schemaStatus: "success",
      schema,
      error: null,
    })
  } catch (error) {
    if (runtime.session !== session) {
      return runtime.state
    }

    return updateState(runtime, {
      schemaStatus: "error",
      error: error instanceof Error ? error.message : "刷新数据库结构失败",
    })
  }
}

async function query(configId: string, sql: string): Promise<QueryResult> {
  const runtime = connections.get(configId)
  const sessionPromise = runtime?.session
  const session = sessionPromise
    ? await sessionPromise.catch(() => {
        if (runtime?.session === sessionPromise) {
          runtime.session = null
        }
        return null
      })
    : null

  if (session) {
    return session.query(sql)
  }

  const config = store.get(`configs.${configId}`)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  return withSession(config, (session) => session.query(sql))
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
