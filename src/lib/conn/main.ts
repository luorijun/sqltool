import { ipcMain } from "electron"
import type { Config, ConfigProfile, DbDriver } from "../config"
import {
  CONNECT,
  type ConnectionEntry,
  type ConnectionState,
  createConnectionState,
  DISCONNECT,
  INSPECT,
  LIST,
  QUERY,
  type QueryResult,
  TEST,
} from "."
import type { ConnectionSession } from "./driver"
import { connectMySql } from "./mysql"
import { connectPostgres } from "./postgres"

interface ManagedSession {
  configId: string
  connectedAt: number
  session: ConnectionSession
  unsubscribe: () => void
}

export interface RegisterConnHandlersOptions {
  getConnectionConfig(configId: string): Config | undefined
  listConnectionConfigs(): Config[]
}

export interface ConnRuntime {
  disconnectConnection(configId: string): Promise<void>
  deleteConnectionState(configId: string): void
}

const activeSessions = new Map<string, ManagedSession>()
const pendingConnections = new Map<string, Promise<ManagedSession>>()
const connectionStates = new Map<string, ConnectionState>()

function getDriverConnector(driver: DbDriver) {
  switch (driver) {
    case "mysql":
      return connectMySql
    case "postgres":
      return connectPostgres
  }
}

function requireConnectionConfig(
  getConnectionConfig: RegisterConnHandlersOptions["getConnectionConfig"],
  configId: string,
): Config {
  const config = getConnectionConfig(configId)
  if (!config) {
    throw new Error("连接不存在或已删除")
  }

  return config
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function getConnectionState(configId: string): ConnectionState {
  return connectionStates.get(configId) ?? createConnectionState(configId)
}

function setConnectionState(
  configId: string,
  nextState: Partial<ConnectionState>,
): ConnectionState {
  const next: ConnectionState = {
    ...getConnectionState(configId),
    ...nextState,
    configId,
  }
  connectionStates.set(configId, next)
  return next
}

function resetConnectionState(configId: string): ConnectionState {
  const next = createConnectionState(configId)
  connectionStates.set(configId, next)
  return next
}

function deleteConnectionState(configId: string): void {
  connectionStates.delete(configId)
}

function listConnections(
  listConnectionConfigs: RegisterConnHandlersOptions["listConnectionConfigs"],
): ConnectionEntry[] {
  return listConnectionConfigs().map((config) => ({
    config,
    state: getConnectionState(config.id),
  }))
}

async function createSession(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  const connect = getDriverConnector(profile.driver)
  return connect(profile)
}

function storeActiveSession(
  configId: string,
  session: ConnectionSession,
): ManagedSession {
  const managed: ManagedSession = {
    configId,
    connectedAt: Date.now(),
    session,
    unsubscribe: () => undefined,
  }

  managed.unsubscribe = session.onDidClose(() => {
    const current = activeSessions.get(configId)
    if (current?.session !== session) {
      return
    }

    managed.unsubscribe()
    activeSessions.delete(configId)
    resetConnectionState(configId)
  })

  activeSessions.set(configId, managed)
  return managed
}

async function ensurePersistentSession(
  configId: string,
  profile: ConfigProfile,
): Promise<ManagedSession> {
  const existing = activeSessions.get(configId)
  if (existing) {
    return existing
  }

  const pending = pendingConnections.get(configId)
  if (pending) {
    return pending
  }

  const nextPending = (async () => {
    const session = await createSession(profile)
    return storeActiveSession(configId, session)
  })()

  pendingConnections.set(configId, nextPending)

  try {
    return await nextPending
  } finally {
    if (pendingConnections.get(configId) === nextPending) {
      pendingConnections.delete(configId)
    }
  }
}

async function getReusableSession(
  configId: string,
): Promise<ManagedSession | null> {
  const active = activeSessions.get(configId)
  if (active) {
    return active
  }

  const pending = pendingConnections.get(configId)
  if (!pending) {
    return null
  }

  try {
    return await pending
  } catch {
    return null
  }
}

async function withTemporarySession<T>(
  profile: ConfigProfile,
  run: (session: ConnectionSession) => Promise<T>,
): Promise<T> {
  const session = await createSession(profile)

  try {
    return await run(session)
  } finally {
    await session.close().catch(() => undefined)
  }
}

async function testConnection(profile: ConfigProfile): Promise<void> {
  await withTemporarySession(profile, async () => undefined)
}

async function connectConnection(
  configId: string,
  profile: ConfigProfile,
): Promise<ConnectionState> {
  setConnectionState(configId, {
    status: "connecting",
    schemaStatus: "loading",
    error: null,
  })

  try {
    const managed = await ensurePersistentSession(configId, profile)
    const schema = await managed.session.inspect()
    const now = Date.now()

    return setConnectionState(configId, {
      status: "connected",
      schemaStatus: "success",
      schema,
      error: null,
      lastConnectedAt: managed.connectedAt,
      lastSchemaAt: now,
    })
  } catch (error) {
    await disconnectConnection(configId).catch(() => undefined)
    setConnectionState(configId, {
      status: "error",
      schemaStatus: "error",
      schema: null,
      error: getErrorMessage(error, "连接失败"),
      lastConnectedAt: null,
      lastSchemaAt: null,
    })
    throw error
  }
}

async function disconnectConnection(configId: string): Promise<void> {
  const pending = pendingConnections.get(configId)
  if (pending) {
    try {
      await pending
    } catch {
      resetConnectionState(configId)
      return
    }
  }

  const managed = activeSessions.get(configId)
  if (!managed) {
    resetConnectionState(configId)
    return
  }

  activeSessions.delete(configId)
  managed.unsubscribe()
  await managed.session.close().catch(() => undefined)
  resetConnectionState(configId)
}

async function inspectConnection(
  configId: string,
  profile: ConfigProfile,
): Promise<ConnectionState> {
  setConnectionState(configId, {
    schemaStatus: "loading",
    error: null,
  })

  try {
    const managed = await getReusableSession(configId)
    const schema = managed
      ? await managed.session.inspect()
      : await withTemporarySession(profile, (session) => session.inspect())
    const now = Date.now()
    const current = getConnectionState(configId)

    return setConnectionState(configId, {
      status: managed ? "connected" : current.status,
      schemaStatus: "success",
      schema,
      error: null,
      lastConnectedAt: managed?.connectedAt ?? current.lastConnectedAt,
      lastSchemaAt: now,
    })
  } catch (error) {
    const current = getConnectionState(configId)
    setConnectionState(configId, {
      status: current.status === "idle" ? "error" : current.status,
      schemaStatus: "error",
      error: getErrorMessage(error, "刷新数据库结构失败"),
    })
    throw error
  }
}

async function queryConnection(
  configId: string,
  profile: ConfigProfile,
  sql: string,
): Promise<QueryResult> {
  const managed = await getReusableSession(configId)
  if (managed) {
    return managed.session.query(sql)
  }

  return withTemporarySession(profile, (session) => session.query(sql))
}

export function registerHandlers(
  options: RegisterConnHandlersOptions,
): ConnRuntime {
  ipcMain.handle(TEST, (_e, profile: ConfigProfile) => testConnection(profile))
  ipcMain.handle(LIST, () => listConnections(options.listConnectionConfigs))
  ipcMain.handle(CONNECT, (_e, configId: string) => {
    const config = requireConnectionConfig(
      options.getConnectionConfig,
      configId,
    )
    return connectConnection(configId, config)
  })
  ipcMain.handle(DISCONNECT, async (_e, configId: string) => {
    await disconnectConnection(configId)
    return getConnectionState(configId)
  })
  ipcMain.handle(INSPECT, (_e, configId: string) => {
    const config = requireConnectionConfig(
      options.getConnectionConfig,
      configId,
    )
    return inspectConnection(configId, config)
  })
  ipcMain.handle(QUERY, (_e, configId: string, sql: string) => {
    const config = requireConnectionConfig(
      options.getConnectionConfig,
      configId,
    )
    return queryConnection(configId, config, sql)
  })

  return {
    disconnectConnection,
    deleteConnectionState,
  }
}
