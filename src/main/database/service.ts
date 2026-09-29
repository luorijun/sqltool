import type { DatabaseApi } from "@/contracts/database"
import { Configs } from "./configs"
import type { DatabaseOptions } from "./ports"
import { Sessions } from "./sessions"

export function createDatabase(options: DatabaseOptions) {
  const configs = new Configs(options.store)
  const sessions = new Sessions({
    configs: configs.list,
    connect: options.connect,
    confirm: options.confirm,
  })
  function checkClosed(id: string) {
    if (sessions.hasResources(id)) throw new Error("连接尚未关闭，请先断开连接")
  }
  return {
    closeOwner: (owner: number, force = false) =>
      sessions.closeOwner(owner, force),
    forOwner(owner: number): DatabaseApi {
      return {
        async test(profile) {
          const client = await options.connect(profile)
          await client.close()
        },
        sync: async () => sessions.snapshot(owner),
        create: (input) => sessions.respond(owner, () => configs.create(input)),
        update: (id, input) =>
          sessions.respond(owner, () => {
            checkClosed(id)
            const config = configs.update(id, input)
            sessions.forget(id)
            return config
          }),
        remove: (id) =>
          sessions.respond(owner, () => {
            checkClosed(id)
            sessions.forget(id)
            configs.remove(id)
          }),
        connect: (id) =>
          sessions.respond(owner, () => sessions.connect(id, owner)),
        disconnect: (id) =>
          sessions.respond(owner, () => sessions.disconnect(id, owner)),
        inspect: (id, source) =>
          sessions.respond(owner, () => sessions.inspect(id, owner, source)),
        openSession: (id, tabId) =>
          sessions.respond(owner, () => sessions.open(id, owner, tabId)),
        closeTab: (tabId) =>
          sessions.respond(owner, () => sessions.closeTab(owner, tabId)),
        query: (id, requestId, sql) =>
          sessions.respond(owner, () =>
            sessions.query(id, owner, requestId, sql),
          ),
        select: (id, tabId, requestId, query) =>
          sessions.respond(owner, () =>
            sessions.select(id, owner, tabId, requestId, query),
          ),
        cancel: (id) =>
          sessions.respond(owner, () => sessions.cancel(id, owner)),
      }
    },
  }
}
export type Database = ReturnType<typeof createDatabase>
