import { atom } from "jotai"
import type { Config } from "."
import configApi from "./renderer"

const _configsAtom = atom<Config[]>([])
const _hasLoadedConfigsAtom = atom(false)

export const configsAtom = atom((get) => get(_configsAtom))

export const hasLoadedConfigsAtom = atom((get) => get(_hasLoadedConfigsAtom))

export const configsByIdAtom = atom((get) => {
  return new Map(
    get(_configsAtom).map((config) => [config.id, config] as const),
  )
})

export const refreshConfigsAtom = atom(null, async (_get, set) => {
  const configs = await configApi.list()
  set(_configsAtom, configs)
  set(_hasLoadedConfigsAtom, true)
  return configs
})

export const upsertConfigAtom = atom(null, (get, set, config: Config) => {
  const configs = get(_configsAtom)
  const index = configs.findIndex((item) => item.id === config.id)

  if (index === -1) {
    set(_configsAtom, [...configs, config])
  } else {
    const next = [...configs]
    next[index] = config
    set(_configsAtom, next)
  }

  set(_hasLoadedConfigsAtom, true)
})

export const removeConfigAtom = atom(null, (get, set, configId: string) => {
  const configs = get(_configsAtom)
  const next = configs.filter((config) => config.id !== configId)

  if (next.length === configs.length) {
    return
  }

  set(_configsAtom, next)
  set(_hasLoadedConfigsAtom, true)
})
