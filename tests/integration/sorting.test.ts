import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { profile, setup, value } from "@tests/integration/helpers"

describe.each(["postgres", "mysql"] as const)("%s browse sorting", (driver) => {
  test("sorts precise integers before paging and quotes column names", async () => {
    const env = await setup(profile(driver))
    const table = `sorting_${randomUUID().replaceAll("-", "")}`
    const column = driver === "postgres" ? '"sort value"' : "`sort value`"
    const from = {
      schema: driver === "postgres" ? "public" : "sqltool_test",
      table,
    }
    try {
      await env.admin.query(
        `CREATE TABLE ${table} (id INT PRIMARY KEY, ${column} BIGINT)`,
      )
      await env.admin.query(
        `INSERT INTO ${table} VALUES (1, 9007199254740993), (2, 9007199254740992), (3, 9007199254740993)`,
      )
      const ascending = value(
        await env.api.select("db", "view", randomUUID(), {
          from,
          orderBy: [
            { column: "sort value", direction: "asc" },
            { column: "id", direction: "asc" },
          ],
          limit: 2,
          offset: 1,
        }),
      )
      expect(ascending.result.rows.map((row) => row[0])).toEqual([1, 3])

      const descending = value(
        await env.api.select("db", "view", randomUUID(), {
          from,
          orderBy: [
            { column: "sort value", direction: "desc" },
            { column: "id", direction: "desc" },
          ],
          limit: 2,
          offset: 0,
        }),
      )
      expect(descending.result.rows.map((row) => row[0])).toEqual([3, 1])
    } finally {
      await env.close([table])
    }
  })
})
