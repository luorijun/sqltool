import { describe, expect, test } from "bun:test"
import { profile, query, tableSource } from "../../src/main/ipc/validation"

describe("database request validation", () => {
  test("accepts exact object names but rejects incomplete table targets", () => {
    const source = { schema: "a.b", table: "quotes' and spaces" }
    expect(tableSource.parse(source)).toEqual(source)
    expect(tableSource.safeParse({ schema: "public" }).success).toBe(false)
    expect(tableSource.safeParse({ ...source, owner: 2 }).success).toBe(false)
  })

  test("rejects unsupported drivers and incomplete SSH settings, and strips caller identity", () => {
    const input = {
      driver: "postgres",
      host: "localhost",
      port: "5432",
      username: "u",
      password: "p",
      database: "db",
    }
    expect(profile.safeParse({ ...input, driver: "unsupported" }).success).toBe(
      false,
    )
    expect(profile.safeParse({ ...input, ssh: { host: "jump" } }).success).toBe(
      false,
    )
    expect(profile.parse({ ...input, owner: 2 })).not.toHaveProperty("owner")
  })

  test("rejects raw conditions and invalid paging", () => {
    const from = { schema: "public", table: "items" }
    expect(query.safeParse({ from, where: { operator: "raw" } }).success).toBe(
      false,
    )
    expect(query.safeParse({ from, limit: -1 }).success).toBe(false)
    expect(
      query.safeParse({
        from,
        where: {
          operator: "and",
          conditions: [{ column: "id", operator: "eq", value: 1 }],
        },
      }).success,
    ).toBe(true)
  })
})
