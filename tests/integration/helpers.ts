import { randomUUID } from "node:crypto"
import type {
  Config,
  ConnResponse,
  DatabaseApi,
  DbDriver,
} from "../../src/contracts/database"
import { connectDriver, createDatabase } from "../../src/main/database"
import type { ConnectionSession } from "../../src/main/database/ports"

export function profile(driver: DbDriver): Config {
  return {
    id: "db",
    driver,
    host: "127.0.0.1",
    port: driver === "postgres" ? "15432" : "13306",
    username: "sqltool",
    password: "sqltool",
    database: "sqltool_test",
    createdAt: 0,
    updatedAt: 0,
  }
}
export function value<T>(response: ConnResponse<T>): T {
  if (response.ok === false) throw new Error(response.error)
  return response.value
}
export async function setup(config: Config) {
  const admin = await connectDriver(profile(config.driver))
  const database = createDatabase({
    store: {
      list: () => [config],
      get: (id) => (id === config.id ? config : undefined),
      set: () => {
        throw new Error("Unexpected config change")
      },
      remove: () => {
        throw new Error("Unexpected config removal")
      },
    },
    connect: connectDriver,
    confirm: async () => true,
  })
  return {
    api: database.forOwner(1),
    admin,
    async close(tables: string[] = []) {
      try {
        await database.closeOwner(1, true)
      } finally {
        try {
          for (const table of tables)
            await admin.query(`DROP TABLE IF EXISTS ${table}`)
        } finally {
          await admin.close()
        }
      }
    },
  }
}
export async function query(api: DatabaseApi, id: string, sql: string) {
  return value(await api.query(id, randomUUID(), sql))
}
export async function pid(api: DatabaseApi, id: string, driver: DbDriver) {
  return Number(
    (
      await query(
        api,
        id,
        driver === "postgres"
          ? "SELECT pg_backend_pid()"
          : "SELECT CONNECTION_ID()",
      )
    ).rows[0][0],
  )
}
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  message: string,
) {
  const deadline = Date.now() + 5000
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
export function waitRunning(
  admin: ConnectionSession,
  driver: DbDriver,
  id: number,
) {
  const sql =
    driver === "postgres"
      ? `SELECT COUNT(*) FROM pg_stat_activity WHERE pid = ${id} AND state = 'active' AND query LIKE '%pg_sleep(%'`
      : `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID = ${id} AND INFO LIKE '%SLEEP(%'`
  return waitFor(
    async () => Number((await admin.query(sql)).rows[0][0]) === 1,
    "Slow query did not start",
  )
}
export function waitClosed(
  admin: ConnectionSession,
  driver: DbDriver,
  id: number,
) {
  const sql =
    driver === "postgres"
      ? `SELECT COUNT(*) FROM pg_stat_activity WHERE pid = ${id}`
      : `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID = ${id}`
  return waitFor(
    async () => Number((await admin.query(sql)).rows[0][0]) === 0,
    "Connection was not released",
  )
}
export const slowSql = (driver: DbDriver) =>
  driver === "postgres" ? "SELECT pg_sleep(15)" : "SELECT 1 WHERE SLEEP(15) = 0"
