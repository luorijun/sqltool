import { type ConfigStore, createConnections } from "@/main/connections"
import type { Connect } from "@/main/drivers"
import { type Confirm, Sessions } from "@/main/sessions"

export function createServices(options: {
  store: ConfigStore
  connect: Connect
  confirm: Confirm
}) {
  const sessions = new Sessions({
    configs: () => options.store.list(),
    connect: options.connect,
    confirm: options.confirm,
  })
  const connections = createConnections(options.store, sessions)
  return { connections, sessions }
}
