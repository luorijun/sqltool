import { atom } from "jotai"
import type { Setter } from "jotai/vanilla"
import type {
  Config,
  ConfigProfile,
  Connection,
  ConnState,
  CreateConfig,
  QueryResult,
  UpdateConfig,
} from "./index"

const connApi = {
  test(profile: ConfigProfile): Promise<void> {
    return window.main.conn.test(profile)
  },
  list(): Promise<Connection[]> {
    return window.main.conn.list()
  },
  get(id: string): Promise<Config | undefined> {
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
  connect(configId: string): Promise<ConnState> {
    return window.main.conn.connect(configId)
  },
  disconnect(configId: string): Promise<ConnState> {
    return window.main.conn.disconnect(configId)
  },
  inspect(configId: string): Promise<ConnState> {
    return window.main.conn.inspect(configId)
  },
  query(configId: string, sql: string): Promise<QueryResult> {
    return window.main.conn.query(configId, sql)
  },
}

export default connApi

const CONNECTIONS_NOT_LOADED = Symbol("connections-not-loaded")
type ConnectionEntriesState = Connection[] | typeof CONNECTIONS_NOT_LOADED

function replaceEntryState(
  entries: ConnectionEntriesState,
  configId: string,
  state: ConnState,
): ConnectionEntriesState {
  if (entries === CONNECTIONS_NOT_LOADED) {
    return entries
  }

  const index = entries.findIndex((entry) => entry.config.id === configId)
  if (index === -1) {
    return entries
  }

  const current = entries[index]
  if (Object.is(current.state, state)) {
    return entries
  }

  const next = [...entries]
  next[index] = {
    ...current,
    state: state,
  }
  return next
}

function patchEntryState(
  entries: ConnectionEntriesState,
  configId: string,
  patch: Partial<ConnState>,
): ConnectionEntriesState {
  if (entries === CONNECTIONS_NOT_LOADED) {
    return entries
  }

  const index = entries.findIndex((entry) => entry.config.id === configId)
  if (index === -1) {
    return entries
  }

  const current = entries[index]

  for (const [key, value] of Object.entries(patch) as Array<
    [keyof ConnState, ConnState[keyof ConnState]]
  >) {
    if (!Object.is(current.state[key], value)) {
      const next = [...entries]
      next[index] = {
        ...current,
        state: {
          ...current.state,
          ...patch,
        },
      }
      return next
    }
  }

  return entries
}

const _connectionEntriesAtom = atom<ConnectionEntriesState>(
  CONNECTIONS_NOT_LOADED,
)

export const connectionEntriesAtom = atom((get) => {
  const entries = get(_connectionEntriesAtom)
  return entries === CONNECTIONS_NOT_LOADED ? null : entries
})

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
  run: () => Promise<ConnState>,
  optimistic?: Partial<ConnState>,
): Promise<ConnState> {
  if (optimistic) {
    set(_connectionEntriesAtom, (entries) =>
      patchEntryState(entries, configId, optimistic),
    )
  }

  try {
    const state = await run()
    set(_connectionEntriesAtom, (entries) =>
      replaceEntryState(entries, configId, state),
    )
    return state
  } catch (error) {
    try {
      await set(refreshConnectionsAtom)
    } catch {
      // ignore refresh failure and rethrow the original error
    }
    throw error
  }
}

export const connectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    return runConnectionAction(set, configId, () => connApi.connect(configId), {
      status: "connecting",
      schemaStatus: "loading",
      error: null,
    })
  },
)

export const disconnectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    return runConnectionAction(set, configId, () =>
      connApi.disconnect(configId),
    )
  },
)

export const refreshConnectionSchemaAtom = atom(
  null,
  async (get, set, configId: string) => {
    const current = get(connectionEntriesAtom)?.find(
      (entry) => entry.config.id === configId,
    )?.state

    if (!current || current.status !== "connected") {
      return set(connectConnectionAtom, configId)
    }

    return runConnectionAction(set, configId, () => connApi.inspect(configId), {
      schemaStatus: "loading",
      error: null,
    })
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
