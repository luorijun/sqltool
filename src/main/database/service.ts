import type { ConnResponse, DatabaseApi } from "@/contracts/database"
import { Configs } from "./configs"
import type { DatabaseOptions } from "./ports"
import { Sessions } from "./sessions"
import { ConnError } from "./tasks"

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
  async function respond<T>(
    owner: number,
    run: () => T | Promise<T>,
  ): Promise<ConnResponse<T>> {
    try {
      const value = await run()
      return { ok: true, value, snapshot: sessions.snapshot(owner) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        kind: error instanceof ConnError ? error.kind : "error",
        snapshot: sessions.snapshot(owner),
      }
    }
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
        create: (input) => respond(owner, () => configs.create(input)),
        update: (id, input) =>
          respond(owner, () => {
            checkClosed(id)
            const config = configs.update(id, input)
            sessions.forget(id)
            return config
          }),
        remove: (id) =>
          respond(owner, () => {
            checkClosed(id)
            sessions.forget(id)
            configs.remove(id)
          }),
        disconnect: (id) =>
          respond(owner, () => sessions.disconnect(id, owner)),
        inspect: (id, source, refresh) =>
          respond(owner, () => sessions.inspect(id, owner, source, refresh)),
        openSession: (id, tabId) =>
          respond(owner, () => sessions.open(id, owner, tabId)),
        closeTab: (tabId) =>
          respond(owner, () => sessions.closeTab(owner, tabId)),
        query: (id, requestId, sql) =>
          respond(owner, () => sessions.query(id, owner, requestId, sql)),
        select: (id, tabId, requestId, query) =>
          respond(owner, () =>
            sessions.select(id, owner, tabId, requestId, query),
          ),
        cancel: (id) => respond(owner, () => sessions.cancel(id, owner)),
      }
    },
  }
}
export type Database = ReturnType<typeof createDatabase>
