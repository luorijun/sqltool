import { atom } from "jotai"
import type { ConfigProfile } from "../config"
import configApi from "../config/renderer"
import type { Connection, ConnState, QueryResult } from "./index"

const connApi = {
  test(profile: ConfigProfile): Promise<void> {
    return window.main.conn.test(profile)
  },
  list(): Promise<Connection[]> {
    return window.main.conn.list()
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

function replaceEntryState(
  entries: Connection[],
  configId: string,
  state: ConnState,
): Connection[] {
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
  entries: Connection[],
  configId: string,
  patch: Partial<ConnState>,
): Connection[] {
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

export const connectionEntriesAtom = atom<Connection[]>([])
const _hasLoadedConnectionsAtom = atom(false)

export const hasLoadedConnectionsAtom = atom((get) =>
  get(_hasLoadedConnectionsAtom),
)

export const refreshConnectionsAtom = atom(null, async (_get, set) => {
  const entries = await connApi.list()
  set(connectionEntriesAtom, entries)
  set(_hasLoadedConnectionsAtom, true)
  return entries
})

export const ensureConnectionsLoadedAtom = atom(null, async (get, set) => {
  if (get(_hasLoadedConnectionsAtom)) {
    return get(connectionEntriesAtom)
  }

  return set(refreshConnectionsAtom)
})

export const testConnectionAtom = atom(
  null,
  async (_get, _set, profile: ConfigProfile) => {
    await connApi.test(profile)
  },
)

export const connectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    set(connectionEntriesAtom, (entries) =>
      patchEntryState(entries, configId, {
        status: "connecting",
        schemaStatus: "loading",
        error: null,
      }),
    )

    try {
      const state = await connApi.connect(configId)
      set(connectionEntriesAtom, (entries) =>
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
  },
)

export const disconnectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    try {
      const state = await connApi.disconnect(configId)
      set(connectionEntriesAtom, (entries) =>
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
  },
)

export const refreshConnectionSchemaAtom = atom(
  null,
  async (get, set, configId: string) => {
    const current = get(connectionEntriesAtom).find(
      (entry) => entry.config.id === configId,
    )?.state

    if (!current || current.status !== "connected") {
      return set(connectConnectionAtom, configId)
    }

    set(connectionEntriesAtom, (entries) =>
      patchEntryState(entries, configId, {
        schemaStatus: "loading",
        error: null,
      }),
    )

    try {
      const state = await connApi.inspect(configId)
      set(connectionEntriesAtom, (entries) =>
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
  },
)

export const deleteConnectionConfigAtom = atom(
  null,
  async (_get, set, configId: string) => {
    await configApi.remove(configId)
    set(connectionEntriesAtom, (entries) => {
      const next = entries.filter((entry) => entry.config.id !== configId)
      return next.length === entries.length ? entries : next
    })
    set(_hasLoadedConnectionsAtom, true)
  },
)
