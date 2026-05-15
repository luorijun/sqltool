import { ipcMain } from "electron"
import type { ConfigProfile } from "../config"
import config from "../config/main"
import {
  CONNECT,
  type Connection,
  type ConnState,
  DISCONNECT,
  INSPECT,
  LIST,
  QUERY,
  type QueryResult,
  TEST,
} from "."
import { type ConnectionSession, connectDriver } from "./driver"

type Runtime = {
  config: ConfigProfile
  session: Promise<ConnectionSession> | null
  state: ConnState
}

const connections = new Map<string, Runtime>()

function requireConfig(configId: string) {
  const entry = config.get(configId)
  if (!entry) {
    throw new Error("连接不存在或已删除")
  }

  return entry
}

function createConnection(): ConnState {
  return {
    status: "idle",
    schemaStatus: "idle",
    schema: null,
    error: null,
  }
}

function ensureRuntime(configId: string, config: ConfigProfile): Runtime {
  const current = connections.get(configId)
  if (current) {
    current.config = config
    return current
  }

  const next: Runtime = {
    config,
    session: null,
    state: createConnection(),
  }
  connections.set(configId, next)
  return next
}

function updateConnection(
  runtime: Runtime,
  nextConnection: Partial<ConnState>,
): ConnState {
  runtime.state = {
    ...runtime.state,
    ...nextConnection,
  }
  return runtime.state
}

function resetConnection(runtime: Runtime): ConnState {
  runtime.state = createConnection()
  return runtime.state
}

function list(): Connection[] {
  return config.list().map((entry) => ({
    config: entry,
    state: connections.get(entry.id)?.state ?? createConnection(),
  }))
}

function ensureSession(runtime: Runtime): Promise<ConnectionSession> {
  if (runtime.session) {
    return runtime.session
  }

  const session = connectDriver(runtime.config).catch((error) => {
    if (runtime.session === session) {
      runtime.session = null
    }
    throw error
  })
  runtime.session = session
  return session
}

async function getSession(
  runtime: Runtime | undefined,
): Promise<ConnectionSession | null> {
  const session = runtime?.session
  if (!session) {
    return null
  }

  try {
    return await session
  } catch {
    if (runtime?.session === session) {
      runtime.session = null
    }
    return null
  }
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

async function connect(configId: string): Promise<ConnState> {
  const runtime = ensureRuntime(configId, requireConfig(configId))

  updateConnection(runtime, {
    status: "connecting",
    schemaStatus: "loading",
    error: null,
  })
  const session = ensureSession(runtime)

  try {
    const activeSession = await session
    const schema = await activeSession.inspect()
    if (runtime.session !== session) {
      return runtime.state
    }

    return updateConnection(runtime, {
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
    return updateConnection(runtime, {
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
    return createConnection()
  }

  const session = runtime.session
  runtime.session = null

  if (!session) {
    return resetConnection(runtime)
  }

  const activeSession = await session.catch(() => null)
  await activeSession?.close().catch(() => undefined)

  if (runtime.session) {
    return runtime.state
  }

  return resetConnection(runtime)
}

async function inspect(configId: string): Promise<ConnState> {
  const runtime = ensureRuntime(configId, requireConfig(configId))

  updateConnection(runtime, {
    schemaStatus: "loading",
    error: null,
  })
  const session = runtime.session

  try {
    const schema = session
      ? await (await session).inspect()
      : await withSession(runtime.config, (session) => session.inspect())
    if (session && runtime.session !== session) {
      return runtime.state
    }

    return updateConnection(runtime, {
      status: session ? "connected" : runtime.state.status,
      schemaStatus: "success",
      schema,
      error: null,
    })
  } catch (error) {
    if (session && runtime.session !== session) {
      return runtime.state
    }

    return updateConnection(runtime, {
      status: runtime.state.status === "idle" ? "error" : runtime.state.status,
      schemaStatus: "error",
      error: error instanceof Error ? error.message : "刷新数据库结构失败",
    })
  }
}

async function query(configId: string, sql: string): Promise<QueryResult> {
  const session = await getSession(connections.get(configId))
  if (session) {
    return session.query(sql)
  }

  return withSession(requireConfig(configId), (session) => session.query(sql))
}

async function remove(configId: string): Promise<void> {
  await disconnect(configId)
  connections.delete(configId)
}

const conn = {
  test,
  list,
  connect,
  disconnect,
  inspect,
  query,
  remove,
}

export default conn

export function registerConn(): void {
  ipcMain.handle(TEST, (_e, profile: ConfigProfile) => {
    return conn.test(profile)
  })
  ipcMain.handle(LIST, () => {
    return conn.list()
  })
  ipcMain.handle(CONNECT, (_e, configId: string) => {
    return conn.connect(configId)
  })
  ipcMain.handle(DISCONNECT, (_e, configId: string) =>
    conn.disconnect(configId),
  )
  ipcMain.handle(INSPECT, (_e, configId: string) => {
    return conn.inspect(configId)
  })
  ipcMain.handle(QUERY, (_e, configId: string, sql: string) => {
    return conn.query(configId, sql)
  })
}
