import { atom } from "jotai"
import type { ConfigProfile } from "../config"
import configApi from "../config/renderer"
import type { ConnectionEntry, ConnectionState, QueryResult } from "./index"

export type { ConnectionEntry, ConnectionState } from "./index"

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

const connApi = {
  test(profile: ConfigProfile): Promise<void> {
    return window.main.conn.test(profile)
  },
  list(): Promise<ConnectionEntry[]> {
    return window.main.conn.list()
  },
  connect(configId: string): Promise<ConnectionState> {
    return window.main.conn.connect(configId)
  },
  disconnect(configId: string): Promise<ConnectionState> {
    return window.main.conn.disconnect(configId)
  },
  inspect(configId: string): Promise<ConnectionState> {
    return window.main.conn.inspect(configId)
  },
  query(configId: string, sql: string): Promise<QueryResult> {
    return window.main.conn.query(configId, sql)
  },
}

export default connApi

function updateEntryState(
  entries: ConnectionEntry[],
  configId: string,
  state: ConnectionState,
): ConnectionEntry[] {
  const index = entries.findIndex((entry) => entry.config.id === configId)
  if (index === -1) {
    return entries
  }

  const current = entries[index]
  if (current.state === state) {
    return entries
  }

  const next = [...entries]
  next[index] = {
    ...current,
    state,
  }
  return next
}

function createTransientState(
  current: ConnectionState | undefined,
  nextState: Partial<ConnectionState>,
): ConnectionState {
  return {
    configId: current?.configId ?? "",
    status: current?.status ?? "idle",
    schemaStatus: current?.schemaStatus ?? "idle",
    schema: current?.schema ?? null,
    error: current?.error ?? null,
    lastConnectedAt: current?.lastConnectedAt ?? null,
    lastSchemaAt: current?.lastSchemaAt ?? null,
    ...nextState,
  }
}

const _connectionEntriesAtom = atom<ConnectionEntry[]>([])
const _hasLoadedConnectionsAtom = atom(false)

export const hasLoadedConnectionsAtom = atom((get) =>
  get(_hasLoadedConnectionsAtom),
)

export const connectionEntriesAtom = atom((get) => get(_connectionEntriesAtom))

export const refreshConnectionsAtom = atom(null, async (_get, set) => {
  const entries = await connApi.list()
  set(_connectionEntriesAtom, entries)
  set(_hasLoadedConnectionsAtom, true)
  return entries
})

export const ensureConnectionsLoadedAtom = atom(null, async (get, set) => {
  if (get(_hasLoadedConnectionsAtom)) {
    return get(_connectionEntriesAtom)
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
  async (get, set, configId: string) => {
    const current = get(_connectionEntriesAtom).find(
      (entry) => entry.config.id === configId,
    )?.state

    set(
      _connectionEntriesAtom,
      updateEntryState(
        get(_connectionEntriesAtom),
        configId,
        createTransientState(current, {
          configId,
          status: "connecting",
          schemaStatus: "loading",
          error: null,
        }),
      ),
    )

    try {
      const state = await connApi.connect(configId)
      set(_connectionEntriesAtom, (entries) =>
        updateEntryState(entries, configId, state),
      )
      return state.schema
    } catch (error) {
      set(_connectionEntriesAtom, (entries) =>
        updateEntryState(
          entries,
          configId,
          createTransientState(current, {
            configId,
            status: "error",
            schemaStatus: "error",
            schema: null,
            error: getErrorMessage(error, "连接失败"),
            lastConnectedAt: null,
            lastSchemaAt: null,
          }),
        ),
      )
      throw error
    }
  },
)

export const disconnectConnectionAtom = atom(
  null,
  async (_get, set, configId: string) => {
    const state = await connApi.disconnect(configId)
    set(_connectionEntriesAtom, (entries) =>
      updateEntryState(entries, configId, state),
    )
  },
)

export const refreshConnectionSchemaAtom = atom(
  null,
  async (get, set, configId: string) => {
    const current = get(_connectionEntriesAtom).find(
      (entry) => entry.config.id === configId,
    )?.state

    if (!current || current.status !== "connected") {
      return set(connectConnectionAtom, configId)
    }

    set(_connectionEntriesAtom, (entries) =>
      updateEntryState(
        entries,
        configId,
        createTransientState(current, {
          configId,
          schemaStatus: "loading",
          error: null,
        }),
      ),
    )

    try {
      const state = await connApi.inspect(configId)
      set(_connectionEntriesAtom, (entries) =>
        updateEntryState(entries, configId, state),
      )
      return state.schema
    } catch (error) {
      set(_connectionEntriesAtom, (entries) =>
        updateEntryState(
          entries,
          configId,
          createTransientState(current, {
            configId,
            status:
              current?.status === "idle"
                ? "error"
                : (current?.status ?? "connected"),
            schemaStatus: "error",
            error: getErrorMessage(error, "刷新数据库结构失败"),
          }),
        ),
      )
      throw error
    }
  },
)

export const deleteConnectionConfigAtom = atom(
  null,
  async (_get, set, configId: string) => {
    await configApi.remove(configId)
    set(_connectionEntriesAtom, (entries) => {
      const next = entries.filter((entry) => entry.config.id !== configId)
      return next.length === entries.length ? entries : next
    })
    set(_hasLoadedConnectionsAtom, true)
  },
)
