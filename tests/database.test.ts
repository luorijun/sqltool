import { describe, expect, test } from "bun:test"
import type {
  Config,
  ConfigProfile,
  ConnResponse,
} from "../src/contracts/database"
import { type ConfigStore, createDatabase } from "../src/main/database"
import type { ConnectionSession } from "../src/main/database/ports"
import {
  config as configSchema,
  file,
  profile,
  query,
  tableSource,
} from "../src/main/ipc/validation"

const input: ConfigProfile = {
  driver: "postgres",
  host: "localhost",
  port: "5432",
  username: "u",
  password: "p",
  database: "db",
}

function value<T>(response: ConnResponse<T>): T {
  if (!response.ok) throw new Error(response.error)
  return response.value
}

function setup() {
  const entries = new Map<string, Config>()
  const store: ConfigStore = {
    list: () => [...entries.values()],
    get: (id) => entries.get(id),
    set: (config) => {
      entries.set(config.id, config)
    },
    remove: (id) => {
      entries.delete(id)
    },
  }
  let closed = 0
  const client: ConnectionSession = {
    inspect: async () => [
      { name: "public", tables: [], views: [], functions: [] },
    ],
    query: async () => ({ columns: [], rows: [] }),
    select: async () => ({
      result: { columns: [], rows: [] },
      executedSql: "SELECT 1",
    }),
    close: async () => {
      closed++
    },
    destroy: () => {
      closed++
    },
    cancel: async () => {},
    onFailure: () => () => {},
  }
  return {
    database: createDatabase({
      store,
      connect: async () => client,
      confirm: async () => true,
    }),
    entries,
    closed: () => closed,
  }
}

describe("database service", () => {
  test("configuration changes require closing resources and invalidate catalog", async () => {
    const { database, entries } = setup()
    const api = database.forOwner(1)
    const config = value(await api.create(input))
    await api.connect(config.id)
    value(await api.inspect(config.id))
    expect((await api.sync()).connections[0].schema).toHaveLength(1)
    expect((await api.update(config.id, { name: "changed" })).ok).toBe(false)
    expect((await api.remove(config.id)).ok).toBe(false)
    expect(entries.get(config.id)?.name).toBeUndefined()
    value(await api.disconnect(config.id))
    value(await api.update(config.id, { name: "changed" }))
    expect((await api.sync()).connections[0].schema).toBeNull()
    expect(entries.get(config.id)?.name).toBe("changed")
    value(await api.remove(config.id))
    expect((await api.sync()).connections).toEqual([])
  })

  test("owner-scoped API rejects another window and cleanup releases resources", async () => {
    const { database, closed } = setup()
    const api = database.forOwner(1)
    const config = value(await api.create(input))
    const sessionId = value(await api.openSession(config.id, "tab"))
    const other = database.forOwner(2)
    expect((await other.sync()).sessions).toEqual([])
    expect((await other.query(sessionId, "foreign", "SELECT 1")).ok).toBe(false)
    value(await api.query(sessionId, "own", "SELECT 1"))
    await database.closeOwner(1, true)
    expect((await api.sync()).sessions).toEqual([])
    expect(closed()).toBe(1)
  })

  test("test connection is closed without adding a configured connection", async () => {
    const { database, closed } = setup()
    await database.forOwner(1).test(input)
    expect(closed()).toBe(1)
    expect((await database.forOwner(1).sync()).connections).toEqual([])
  })
})

describe("IPC validation", () => {
  test("table refresh accepts exact object names and rejects incomplete targets", () => {
    const source = { schema: "a.b", table: "quotes' and spaces" }
    expect(tableSource.parse(source)).toEqual(source)
    expect(tableSource.safeParse({ schema: "public" }).success).toBe(false)
    expect(tableSource.safeParse({ schema: "", table: "items" }).success).toBe(
      false,
    )
    expect(tableSource.safeParse({ ...source, owner: 2 }).success).toBe(false)
  })
  test("accepts profiles and partial updates but rejects malformed driver and SSH data", () => {
    expect(profile.parse(input)).toEqual(input)
    expect(configSchema.partial().parse({ name: "renamed" })).toEqual({
      name: "renamed",
    })
    expect(profile.safeParse({ ...input, driver: "unsupported" }).success).toBe(
      false,
    )
    expect(profile.safeParse({ ...input, ssh: { host: "jump" } }).success).toBe(
      false,
    )
  })
  test("validates nested queries and save options; caller identity is not accepted as input", () => {
    expect(
      query.safeParse({
        from: { schema: "public", table: "t" },
        where: {
          operator: "and",
          conditions: [{ column: "id", operator: "eq", value: 1 }],
        },
      }).success,
    ).toBe(true)
    expect(
      query.safeParse({
        from: { schema: "public", table: "t" },
        where: { operator: "raw" },
      }).success,
    ).toBe(false)
    expect(
      query.safeParse({ from: { schema: "public", table: "t" }, limit: -1 })
        .success,
    ).toBe(false)
    expect(file.safeParse({ content: 123 }).success).toBe(false)
    expect(profile.parse({ ...input, owner: 2 })).not.toHaveProperty("owner")
  })
})
