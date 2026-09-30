import { describe, expect, mock, test } from "bun:test"
import { Metadata } from "../../src/main/database/metadata"
import type {
  ColumnType,
  ConnectionSession,
  DriverResult,
} from "../../src/main/database/ports"

function result(oid = 869, modifier = -1): DriverResult {
  return {
    columns: [
      {
        id: "ip",
        name: "ip",
        typeCode: oid,
        typeFamily: "unknown",
        typeRef: { oid, modifier },
      },
    ],
    rows: [["192.0.2.1"]],
  }
}

function setup() {
  let now = 0
  const types = mock<NonNullable<ConnectionSession["types"]>>(async (refs) =>
    refs.map((ref) => ({
      dbType: `type_${ref.oid}_${ref.modifier}`,
      typeFamily: "string",
    })),
  )
  const client: ConnectionSession = {
    types,
    inspect: async () => [
      { name: "public", tables: [], views: [], functions: [] },
    ],
    query: async () => result(),
    select: async () => ({ result: result(), executedSql: "SELECT" }),
    close: async () => {},
    destroy: () => {},
    cancel: async () => {},
    onFailure: () => () => {},
  }
  const metadata = new Metadata(
    async (_id, read) => read(client),
    () => now,
  )
  return {
    metadata,
    client,
    types,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("metadata", () => {
  test("batches distinct type modifiers and shares cache only within one configuration", async () => {
    const { metadata, types } = setup()
    const input = result(1043, 24)
    input.columns.push(
      { ...input.columns[0], id: "duplicate" },
      ...result(1043, 204).columns,
    )
    const value = await metadata.complete("a", input)
    expect(types).toHaveBeenCalledWith([
      { oid: 1043, modifier: 24 },
      { oid: 1043, modifier: 204 },
    ])
    expect(value.columns.map((column) => column.dbType)).toEqual([
      "type_1043_24",
      "type_1043_24",
      "type_1043_204",
    ])
    expect(value.columns.some((column) => "typeRef" in column)).toBe(false)
    await metadata.complete("a", input)
    expect(types).toHaveBeenCalledTimes(1)
    await metadata.complete("b", input)
    expect(types).toHaveBeenCalledTimes(2)
  })

  test("shared lookups continue when one consumer cancels", async () => {
    const { metadata, client } = setup()
    const pending = Promise.withResolvers<Array<ColumnType | null>>()
    const types = mock(() => pending.promise)
    client.types = types
    const abort = new AbortController()
    const first = metadata.complete("a", result(), abort.signal)
    const second = metadata.complete("a", result())
    try {
      abort.abort()
      expect((await first).columns[0].dbType).toBeUndefined()
      expect(types).toHaveBeenCalledTimes(1)
      pending.resolve([{ dbType: "inet", typeFamily: "string" }])
      expect((await second).columns[0].dbType).toBe("inet")
      expect((await metadata.complete("a", result())).columns[0].dbType).toBe(
        "inet",
      )
      expect(types).toHaveBeenCalledTimes(1)
    } finally {
      pending.resolve([])
      await Promise.all([first, second])
    }
  })

  test("expired, refreshed and disconnected entries are queried again", async () => {
    const { metadata, types, advance } = setup()
    await metadata.complete("a", result())
    advance(5 * 60_000)
    await metadata.complete("a", result())
    expect(types).toHaveBeenCalledTimes(2)
    await metadata.inspect("a")
    expect(metadata.snapshot("a").schema).toHaveLength(1)
    await metadata.complete("a", result())
    expect(types).toHaveBeenCalledTimes(3)
    metadata.disconnected("a")
    expect(metadata.snapshot("a")).toMatchObject({
      schema: null,
      generation: 1,
    })
    await metadata.complete("a", result())
    expect(types).toHaveBeenCalledTimes(4)
  })

  test("stale responses cannot repopulate a replaced cache", async () => {
    const { metadata, client } = setup()
    const pending = Promise.withResolvers<Array<ColumnType | null>>()
    client.types = () => pending.promise
    const old = metadata.complete("a", result())
    try {
      metadata.invalidate("a")
      client.types = async () => [{ dbType: "new_name", typeFamily: "string" }]
      expect((await metadata.complete("a", result())).columns[0].dbType).toBe(
        "new_name",
      )
      pending.resolve([{ dbType: "old_name", typeFamily: "string" }])
      expect((await old).columns[0].dbType).toBeUndefined()
      expect((await metadata.complete("a", result())).columns[0].dbType).toBe(
        "new_name",
      )
    } finally {
      pending.resolve([])
      await old
    }
  })

  test("lookup failures and unknown types preserve rows and are not cached", async () => {
    const { metadata, client } = setup()
    client.types = async () => {
      throw new Error("metadata unavailable")
    }
    const failed = await metadata.complete("a", result())
    expect(failed.rows).toEqual(result().rows)
    expect(failed.columns[0]).toMatchObject({
      typeFamily: "unknown",
      typeCode: 869,
    })
    expect(metadata.snapshot("a").error).toBe("metadata unavailable")
    const types = mock<NonNullable<ConnectionSession["types"]>>(async () => [
      null,
    ])
    client.types = types
    await metadata.complete("a", result())
    await metadata.complete("a", result())
    expect(types).toHaveBeenCalledTimes(2)
    client.types = async () => [{ dbType: "inet", typeFamily: "string" }]
    expect((await metadata.complete("a", result())).columns[0].dbType).toBe(
      "inet",
    )
  })

  test("structure reads are shared and disconnected responses cannot restore old schemas", async () => {
    const { metadata, client } = setup()
    const pending =
      Promise.withResolvers<Awaited<ReturnType<ConnectionSession["inspect"]>>>()
    const inspect = mock(() => pending.promise)
    client.inspect = inspect
    const first = metadata.inspect("a")
    const second = metadata.inspect("a")
    try {
      expect(inspect).toHaveBeenCalledTimes(1)
      metadata.disconnected("a")
      pending.resolve([{ name: "stale", tables: [], views: [], functions: [] }])
      await Promise.all([first, second])
      expect(metadata.snapshot("a").schema).toBeNull()
    } finally {
      pending.resolve([])
      await Promise.all([first, second])
    }
  })

  test("the type cache has a bounded number of entries", async () => {
    const { metadata, types } = setup()
    const input = result()
    input.columns = Array.from(
      { length: 2049 },
      (_, index) => result(index + 1).columns[0],
    )
    await metadata.complete("a", input)
    await metadata.complete("a", result(2049))
    expect(types).toHaveBeenCalledTimes(1)
    await metadata.complete("a", result(1))
    expect(types).toHaveBeenCalledTimes(2)
  })
})
