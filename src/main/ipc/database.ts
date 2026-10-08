import { ConnError, type TableSource } from "@/core/database"
import type { Connections } from "@/main/connections"
import type { Connect } from "@/main/drivers"
import type { Sessions } from "@/main/sessions"
import type { ConnResponse, DatabaseApi } from "@/preload/bridge"

export function createDatabaseApi(
  owner: number,
  connections: Connections,
  sessions: Sessions,
  connect: Connect,
) {
  async function respond<T>(
    run: () => T | Promise<T>,
  ): Promise<ConnResponse<T>> {
    try {
      const value = await run()
      return { ok: true, value, snapshot: connections.snapshot(owner) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        kind: error instanceof ConnError ? error.kind : "error",
        snapshot: connections.snapshot(owner),
      }
    }
  }
  return {
    async test(profile) {
      const client = await connect(profile)
      await client.close()
    },
    sync: async () => connections.snapshot(owner),
    create: (input) => respond(() => connections.create(input)),
    update: (id, input) => respond(() => connections.update(id, input)),
    remove: (id) => respond(() => connections.remove(id)),
    disconnect: (id) => respond(() => sessions.disconnect(id, owner)),
    inspect: (id: string, source?: TableSource, refresh = false) =>
      respond(() => sessions.inspect(id, owner, source, refresh)),
    openSession: (id, tabId) => respond(() => sessions.open(id, owner, tabId)),
    closeTab: (tabId) => respond(() => sessions.closeTab(owner, tabId)),
    query: (id, requestId, sql) =>
      respond(() => sessions.query(id, owner, requestId, sql)),
    select: (id, tabId, requestId, query) =>
      respond(() => sessions.select(id, owner, tabId, requestId, query)),
    cancel: (id) => respond(() => sessions.cancel(id, owner)),
  } satisfies DatabaseApi
}
