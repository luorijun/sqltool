import { atom } from "jotai"
import type { Setter } from "jotai/vanilla"
import type {
  Config,
  ConfigProfile,
  Connection,
  CreateConfig,
  QueryResult,
  UpdateConfig,
} from "./index"

type ConnectionAction = "connect" | "disconnect" | "inspect"

const connApi = {
  test(profile: ConfigProfile): Promise<void> {
    return window.main.conn.test(profile)
  },
  list(): Promise<Connection[]> {
    return window.main.conn.list()
  },
  get(id: string): Promise<Connection | undefined> {
    return window.main.conn.get(id)
  },
  create(input: CreateConfig): Promise<Config> {
    return window.main.conn.create(input)
  },
  update(id: string, input: UpdateConfig): Promise<Config> {
    return window.main.conn.update(id, input)
  },
  remove(id: string): Promise<void> {
    return window.main.conn.remove(id)
  },
  connect(configId: string): Promise<Connection> {
    return window.main.conn.connect(configId)
  },
  disconnect(configId: string): Promise<Connection> {
    return window.main.conn.disconnect(configId)
  },
  inspect(configId: string): Promise<Connection> {
    return window.main.conn.inspect(configId)
  },
  query(configId: string, sql: string): Promise<QueryResult> {
    return window.main.conn.query(configId, sql)
  },
}

export default connApi

const CONNECTIONS_NOT_LOADED = Symbol("connections-not-loaded")
type ConnectionEntriesState = Connection[] | typeof CONNECTIONS_NOT_LOADED
type ConnectionActionState = Record<string, ConnectionAction | undefined>

function replaceEntryState(
  entries: ConnectionEntriesState,
  configId: string,
  connection: Connection,
): ConnectionEntriesState {
  if (entries === CONNECTIONS_NOT_LOADED) {
    return entries
  }

  const index = entries.findIndex((entry) => entry.config.id === configId)
  if (index === -1) {
    return entries
  }

  const current = entries[index]
  if (Object.is(current, connection)) {
    return entries
  }

  const next = [...entries]
  next[index] = connection
  return next
}

const _connectionEntriesAtom = atom<ConnectionEntriesState>(
  CONNECTIONS_NOT_LOADED,
)
const _connectionActionAtom = atom<ConnectionActionState>({})

export const connectionEntriesAtom = atom((get) => {
  const entries = get(_connectionEntriesAtom)
  return entries === CONNECTIONS_NOT_LOADED ? null : entries
})

export const connectionActionAtom = atom((get) => get(_connectionActionAtom))

export const refreshConnectionsAtom = atom(null, async (_get, set) => {
  const entries = await connApi.list()
  set(_connectionEntriesAtom, entries)
  return entries
})

export const ensureConnectionsLoadedAtom = atom(null, async (get, set) => {
  const entries = get(_connectionEntriesAtom)
  if (entries !== CONNECTIONS_NOT_LOADED) {
    return entries
  }

  return set(refreshConnectionsAtom)
})

async function runConnectionAction(
  set: Setter,
  configId: string,
  action: ConnectionAction,
  run: () => Promise<Connection>,
): Promise<Connection> {
  set(_connectionActionAtom, (actions) => ({
    ...actions,
    [configId]: action,
  }))

  let error: unknown

  try {
    const connection = await run()
    set(_connectionEntriesAtom, (entries) =>
      replaceEntryState(entries, configId, connection),
    )
    return connection
  } catch (caughtError) {
    error = caughtError
  } finally {
    set(_connectionActionAtom, (actions) => {
      if (!actions[configId]) {
        return actions
      }

      const next = { ...actions }
      delete next[configId]
      return next
    })
  }

  throw error
}

export const connectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    return runConnectionAction(set, configId, "connect", () =>
      connApi.connect(configId),
    )
  },
)

export const disconnectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    return runConnectionAction(set, configId, "disconnect", () =>
      connApi.disconnect(configId),
    )
  },
)

export const refreshConnectionSchemaAtom = atom(
  null,
  async (get, set, configId: string) => {
    let current = get(connectionEntriesAtom)?.find(
      (entry) => entry.config.id === configId,
    )

    if (!current?.connected) {
      current = await runConnectionAction(set, configId, "connect", () =>
        connApi.connect(configId),
      )

      if (!current.connected) {
        return current
      }
    }

    return runConnectionAction(set, configId, "inspect", () =>
      connApi.inspect(configId),
    )
  },
)

export const deleteConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    await connApi.remove(configId)
    set(_connectionEntriesAtom, (entries) => {
      if (entries === CONNECTIONS_NOT_LOADED) {
        return entries
      }

      const next = entries.filter((entry) => entry.config.id !== configId)
      return next.length === entries.length ? entries : next
    })
  },
)
