import { expect, mock, test } from "bun:test"
import { drain } from "@tests/support/async"
import { connection, setup, value } from "@tests/support/backend"
import type { ColumnType, DriverResult } from "@/main/drivers"

test("structure consumers queue behind one load and use its completed cache", async () => {
  const started = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const inspect = mock(async () => {
    started.resolve()
    await ready.promise
    return []
  })
  const connect = mock(async () => ({ ...connection().client, inspect }))
  const { api, database } = setup({ connect })
  const first = api.inspect("db")
  try {
    await started.promise
    const second = database.forOwner(2).inspect("db")
    const third = api.inspect("db")
    ready.resolve()
    for (const response of await Promise.all([first, second, third])) {
      value(response)
      expect(response.snapshot.connections[0].schema).toEqual([])
    }
    value(await api.inspect("db"))
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(1)
    expect((await api.sync()).sessions.map((session) => session.kind)).toEqual([
      "schema",
    ])
  } finally {
    ready.resolve()
    await first
    await database.closeOwner(2, true)
  }
})

test("a queued consumer sees a refresh; targeted refresh without a cache loads the full structure", async () => {
  const started = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  let reads = 0
  const inspect = mock(async () => {
    reads++
    if (reads === 2) {
      started.resolve()
      await ready.promise
    }
    return [{ name: `schema_${reads}`, tables: [], views: [], functions: [] }]
  })
  const { api } = setup({
    connect: async () => ({ ...connection().client, inspect }),
  })
  value(await api.inspect("db", { schema: "app", table: "users" }, true))
  expect(inspect).toHaveBeenLastCalledWith(undefined)
  const refresh = api.inspect("db", undefined, true)
  try {
    await started.promise
    const consumer = api.inspect("db")
    ready.resolve()
    value(await refresh)
    const response = await consumer
    value(response)
    expect(response.snapshot.connections[0].schema?.[0].name).toBe("schema_2")
    expect(reads).toBe(2)
  } finally {
    ready.resolve()
    await refresh
  }
})

test("failed structure reads can retry and disconnect clears the shared cache", async () => {
  let reads = 0
  const inspect = mock(async () => {
    if (++reads === 1) throw new Error("structure unavailable")
    return [{ name: "app", tables: [], views: [], functions: [] }]
  })
  const connect = mock(async () => ({ ...connection().client, inspect }))
  const { api } = setup({ connect })
  expect((await api.inspect("db")).ok).toBe(false)
  value(await api.inspect("db"))
  expect(reads).toBe(2)
  value(await api.disconnect("db"))
  expect((await api.sync()).connections[0].schema).toBeNull()
  value(await api.inspect("db"))
  expect(reads).toBe(3)
  expect(connect).toHaveBeenCalledTimes(2)
})

test("concurrent window closure releases the last shared metadata connection", async () => {
  const { api, database, clients } = setup()
  value(await api.inspect("db"))
  value(await database.forOwner(2).inspect("db"))
  expect(clients).toHaveLength(1)
  const destroy = mock(clients[0].client.destroy)
  clients[0].client.destroy = destroy
  await Promise.all([
    database.closeOwner(1, true),
    database.closeOwner(2, true),
  ])
  expect(destroy).toHaveBeenCalledTimes(1)
  expect((await api.sync()).connections[0].sessionCount).toBe(0)
})

test("concurrent metadata reads wait for the dedicated connection's initialization", async () => {
  const ready = Promise.withResolvers<void>()
  const preparing = Promise.withResolvers<void>()
  const queried = Promise.withResolvers<void>()
  const reads = mock(async () => [
    { dbType: "inet", typeFamily: "string" as const },
  ])
  const { api } = setup({
    connect: async () => {
      const entry = connection()
      entry.client.prepareMetadata = async () => {
        preparing.resolve()
        await ready.promise
      }
      entry.client.types = reads
      entry.client.query = async () => {
        queried.resolve()
        return {
          columns: [
            {
              id: "ip",
              name: "ip",
              typeFamily: "unknown",
              typeRef: { driver: "postgres", oid: 869, modifier: -1 },
            },
          ],
          rows: [],
        }
      }
      return entry.client
    },
  })
  const firstSession = value(await api.openSession("db", "first"))
  const connecting = api.query(firstSession, "first", "SELECT ip")
  let query: ReturnType<typeof api.query> | undefined
  try {
    await preparing.promise
    const session = value(await api.openSession("db", "a"))
    query = api.query(session, "query", "SELECT ip")
    await queried.promise
    await drain()
    expect(reads).not.toHaveBeenCalled()
    ready.resolve()
    value(await connecting)
    expect(value(await query).columns[0].dbType).toBe("inet")
  } finally {
    ready.resolve()
    await Promise.all([connecting, query])
  }
})

test("metadata is shared across windows and a cancelled consumer does not cancel other lookups", async () => {
  const pending = Promise.withResolvers<Array<ColumnType | null>>()
  const started = Promise.withResolvers<void>()
  const reads = mock(() => {
    started.resolve()
    return pending.promise
  })
  const opened: Array<
    ReturnType<typeof connection> & { destroy: ReturnType<typeof mock> }
  > = []
  const typed: DriverResult = {
    columns: [
      {
        id: "ip",
        name: "ip",
        typeFamily: "unknown",
        typeCode: 869,
        typeRef: { driver: "postgres", oid: 869, modifier: -1 },
      },
    ],
    rows: [["192.0.2.1"]],
  }
  const { api, database } = setup({
    connect: async () => {
      const entry = connection()
      const destroy = mock(entry.client.destroy)
      entry.client.destroy = destroy
      entry.client.query = async () => typed
      entry.client.types = reads
      opened.push({ ...entry, destroy })
      return entry.client
    },
  })
  const other = database.forOwner(2)
  const a = value(await api.openSession("db", "a"))
  const b = value(await other.openSession("db", "b"))
  const first = api.query(a, "first", "SELECT ip")
  let second: ReturnType<typeof other.query> | undefined
  try {
    await started.promise
    second = other.query(b, "second", "SELECT ip")
    value(await api.cancel("first"))
    const cancelled = value(await first)
    expect(cancelled.rows).toEqual(typed.rows)
    expect(cancelled.columns[0].dbType).toBeUndefined()
    await database.closeOwner(1, true)
    expect(opened[1].destroy).not.toHaveBeenCalled()
    pending.resolve([{ dbType: "inet", typeFamily: "string" }])
    expect(value(await second).columns[0].dbType).toBe("inet")
    expect(reads).toHaveBeenCalledTimes(1)
    expect(
      (await other.sync()).sessions.filter(
        (session) => session.kind === "schema",
      ),
    ).toHaveLength(1)
    await database.closeOwner(2, true)
    expect(opened[1].destroy).toHaveBeenCalledTimes(1)
  } finally {
    pending.resolve([])
    await Promise.all([first, second])
    await database.closeOwner(2, true)
  }
})
