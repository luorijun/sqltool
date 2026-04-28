import { atom } from "jotai"
import type { Getter, Setter } from "jotai/vanilla"
import type { Config } from "@/lib/config"
import configApi from "@/lib/config/renderer"
import {
  configsAtom,
  configsByIdAtom,
  hasLoadedConfigsAtom,
  refreshConfigsAtom,
  removeConfigAtom as removeStoredConfigAtom,
  upsertConfigAtom,
} from "@/lib/config/state"
import type { DbSchema } from "."
import connApi from "./renderer"

export interface ConnectionState {
  configId: string
  status: "idle" | "connecting" | "connected" | "error"
  schemaStatus: "idle" | "loading" | "success" | "error"
  schema: DbSchema[] | null
  error: string | null
  lastConnectedAt: number | null
  lastSchemaAt: number | null
}

function createConnectionState(configId: string): ConnectionState {
  return {
    configId,
    status: "idle",
    schemaStatus: "idle",
    schema: null,
    error: null,
    lastConnectedAt: null,
    lastSchemaAt: null,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function syncConnectionStates(
  current: Record<string, ConnectionState>,
  configs: Config[],
): Record<string, ConnectionState> {
  const nextIds = new Set(configs.map((config) => config.id))
  let changed = Object.keys(current).length !== nextIds.size
  const next: Record<string, ConnectionState> = {}

  for (const config of configs) {
    const state = current[config.id]
    if (state) {
      next[config.id] = state
      continue
    }

    changed = true
  }

  if (!changed) {
    for (const id of Object.keys(current)) {
      if (!nextIds.has(id)) {
        changed = true
        break
      }
    }
  }

  return changed ? next : current
}

async function resolveConfig(
  get: Getter,
  set: Setter,
  input: Config | string,
): Promise<Config | undefined> {
  if (typeof input !== "string") {
    return input
  }

  const cached = get(configsByIdAtom).get(input)
  if (cached) {
    return cached
  }

  const config = await configApi.get(input)
  if (config) {
    set(upsertConfigAtom, config)
  }

  return config
}

function updateConnectionState(
  current: Record<string, ConnectionState>,
  configId: string,
  nextState: Partial<ConnectionState>,
): Record<string, ConnectionState> {
  return {
    ...current,
    [configId]: {
      ...(current[configId] ?? createConnectionState(configId)),
      ...nextState,
    },
  }
}

const _connectionStatesAtom = atom<Record<string, ConnectionState>>({})

export const hasLoadedConnectionsAtom = atom((get) => get(hasLoadedConfigsAtom))

export const connectionStateMapAtom = atom((get) => {
  const configs = get(configsAtom)
  const states = get(_connectionStatesAtom)

  return new Map(
    configs.map((config) => [
      config.id,
      states[config.id] ?? createConnectionState(config.id),
    ]),
  )
})

export const connectionEntriesAtom = atom((get) => {
  const stateMap = get(connectionStateMapAtom)

  return get(configsAtom).map((config) => ({
    config,
    state: stateMap.get(config.id) ?? createConnectionState(config.id),
  }))
})

export const refreshConnectionsAtom = atom(null, async (_get, set) => {
  const configs = await set(refreshConfigsAtom)
  set(_connectionStatesAtom, (current) =>
    syncConnectionStates(current, configs),
  )
  return configs
})

export const ensureConnectionsLoadedAtom = atom(null, async (get, set) => {
  if (get(hasLoadedConfigsAtom)) {
    return get(configsAtom)
  }

  return set(refreshConnectionsAtom)
})

export const upsertConnectionConfigAtom = atom(
  null,
  (_get, set, config: Config) => {
    set(upsertConfigAtom, config)
    set(_connectionStatesAtom, (current) => {
      if (!current[config.id]) {
        return current
      }

      return updateConnectionState(current, config.id, {
        status: "idle",
        schemaStatus: "idle",
        schema: null,
        error: null,
      })
    })
  },
)

export const deleteConnectionConfigAtom = atom(
  null,
  async (get, set, input: Config | string) => {
    const config = await resolveConfig(get, set, input)
    if (!config) {
      throw new Error("连接不存在或已删除")
    }

    await configApi.remove(config.id)
    set(removeStoredConfigAtom, config.id)
    set(_connectionStatesAtom, (current) => {
      if (!current[config.id]) {
        return current
      }

      const next = { ...current }
      delete next[config.id]
      return next
    })
  },
)

export const testConnectionAtom = atom(
  null,
  async (get, set, input: Config | string) => {
    const config = await resolveConfig(get, set, input)
    if (!config) {
      throw new Error("连接不存在或已删除")
    }

    await connApi.test(config)
  },
)

export const connectConnectionAtom = atom(
  null,
  async (get, set, configId: string) => {
    const config = await resolveConfig(get, set, configId)
    if (!config) {
      throw new Error("连接不存在或已删除")
    }

    set(_connectionStatesAtom, (current) =>
      updateConnectionState(current, configId, {
        status: "connecting",
        schemaStatus: "loading",
        error: null,
      }),
    )

    try {
      const schema = await connApi.inspect(config)
      const now = Date.now()

      set(_connectionStatesAtom, (current) =>
        updateConnectionState(current, configId, {
          status: "connected",
          schemaStatus: "success",
          schema,
          error: null,
          lastConnectedAt: now,
          lastSchemaAt: now,
        }),
      )

      return schema
    } catch (error) {
      const message = getErrorMessage(error, "连接失败")

      set(_connectionStatesAtom, (current) =>
        updateConnectionState(current, configId, {
          status: "error",
          schemaStatus: "error",
          schema: null,
          error: message,
        }),
      )

      throw error
    }
  },
)

export const disconnectConnectionAtom = atom(
  null,
  (_get, set, configId: string) => {
    set(_connectionStatesAtom, (current) => {
      if (!current[configId]) {
        return current
      }

      return {
        ...current,
        [configId]: createConnectionState(configId),
      }
    })
  },
)

export const refreshConnectionSchemaAtom = atom(
  null,
  async (get, set, configId: string) => {
    const currentState = get(connectionStateMapAtom).get(configId)
    if (!currentState || currentState.status !== "connected") {
      return set(connectConnectionAtom, configId)
    }

    const config = await resolveConfig(get, set, configId)
    if (!config) {
      throw new Error("连接不存在或已删除")
    }

    set(_connectionStatesAtom, (current) =>
      updateConnectionState(current, configId, {
        schemaStatus: "loading",
        error: null,
      }),
    )

    try {
      const schema = await connApi.inspect(config)
      const now = Date.now()

      set(_connectionStatesAtom, (current) =>
        updateConnectionState(current, configId, {
          status: "connected",
          schemaStatus: "success",
          schema,
          error: null,
          lastConnectedAt: current[configId]?.lastConnectedAt ?? now,
          lastSchemaAt: now,
        }),
      )

      return schema
    } catch (error) {
      const message = getErrorMessage(error, "刷新数据库结构失败")

      set(_connectionStatesAtom, (current) =>
        updateConnectionState(current, configId, {
          status: "connected",
          schemaStatus: "error",
          error: message,
        }),
      )

      throw error
    }
  },
)
