import { afterEach } from "bun:test"
import { config } from "@tests/support/config"
import type { DatabaseOptions } from "@tests/support/database"
import { createDatabase } from "@tests/support/database"
import type { QueryResult } from "@/core/database"
import type { ConnectionSession } from "@/main/drivers"
import type { ConnResponse } from "@/preload/bridge"

export { config } from "@tests/support/config"
export const result: QueryResult = { columns: [], rows: [], rowCount: 0 }
const databases: ReturnType<typeof createDatabase>[] = []
export function value<T>(response: ConnResponse<T>): T {
  if (response.ok === false) throw new Error(response.error)
  return response.value
}
export function connection() {
  const sql: string[] = []
  const closed = Promise.withResolvers<void>()
  let fail: (error: Error) => void = () => {}
  let state: Awaited<ReturnType<ConnectionSession["transaction"]>> = "idle"
  const client: ConnectionSession = {
    transaction: async () => state,
    query: async (text) => {
      sql.push(text)
      if (text === "BEGIN") state = "active"
      if (text === "COMMIT" || text === "ROLLBACK") state = "idle"
      return result
    },
    inspect: async () => [
      { name: "public", tables: [], views: [], functions: [] },
    ],
    close: async () => closed.resolve(),
    destroy: () => closed.resolve(),
    cancel: async () => {},
    onFailure: (listener) => {
      fail = listener
      return () => {
        fail = () => {}
      }
    },
  }
  return { client, sql, closed, fail: () => fail(new Error("connection lost")) }
}
export function setup(
  options: Partial<Pick<DatabaseOptions, "connect" | "confirm">> = {},
) {
  const entries = new Map([[config.id, { ...config }]])
  const clients: ReturnType<typeof connection>[] = []
  const database = createDatabase({
    store: {
      list: () => [...entries.values()],
      get: (id) => entries.get(id),
      set: (entry) => {
        entries.set(entry.id, entry)
      },
      remove: (id) => {
        entries.delete(id)
      },
    },
    connect: async () => {
      const client = connection()
      clients.push(client)
      return client.client
    },
    confirm: async () => true,
    ...options,
  })
  databases.push(database)
  return { database, api: database.forOwner(1), clients, entries }
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})
