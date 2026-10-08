import type { ConfigDraft, ConnSnapshot } from "@/core/database"
import type { Sessions } from "@/main/sessions"
import { Configs } from "./configs"
import type { ConfigStore } from "./store"

export { type ConfigStore, createConfigStore } from "./store"

export function createConnections(store: ConfigStore, sessions: Sessions) {
  const configs = new Configs(store)
  let version = 0
  const checkClosed = (id: string) => {
    if (sessions.hasResources(id)) throw new Error("连接尚未关闭，请先断开连接")
  }
  return {
    create: (input: ConfigDraft) => configs.create(input),
    update(id: string, input: Partial<ConfigDraft>) {
      checkClosed(id)
      const config = configs.update(id, input)
      sessions.forget(id)
      return config
    },
    remove(id: string) {
      checkClosed(id)
      sessions.forget(id)
      configs.remove(id)
    },
    snapshot(owner: number): ConnSnapshot {
      return {
        version: ++version,
        connections: configs
          .list()
          .map((config) => ({ config, ...sessions.connection(config.id) })),
        ...sessions.snapshot(owner),
      }
    },
  }
}
export type Connections = ReturnType<typeof createConnections>
