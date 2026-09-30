import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { profile, setup, value } from "./helpers"

test("PostgreSQL resolves catalog names, modifiers and user-defined types through metadata", async () => {
  const env = await setup(profile("postgres"))
  const name = `Mood_${randomUUID().replaceAll("-", "")}`
  try {
    await env.admin.query(
      `CREATE TYPE public."${name}" AS ENUM ('happy', 'sad')`,
    )
    const session = value(await env.api.openSession("db", "types"))
    const sql = `SELECT '192.0.2.1'::inet AS address, NULL::inet[] AS addresses,
      NULL::varchar(20) AS short, NULL::varchar(200) AS long,
      NULL::numeric(8,2) AS amount, NULL::numeric(3,-1) AS rounded,
      NULL::public."${name}" AS mood, NULL::public."${name}"[] AS moods,
      NULL::timestamptz(3) AS created, NULL::int4range AS range`
    const result = value(await env.api.query(session, randomUUID(), sql))
    expect(result.columns.map((column) => column.dbType)).toEqual([
      "inet",
      "inet[]",
      "character varying(20)",
      "character varying(200)",
      "numeric(8,2)",
      "numeric(3,-1)",
      `public."${name}"`,
      `public."${name}"[]`,
      "timestamp(3) with time zone",
      "int4range",
    ])
    expect(result.columns.map((column) => column.typeFamily)).toEqual([
      "string",
      "array",
      "string",
      "string",
      "decimal",
      "decimal",
      "string",
      "array",
      "datetime",
      "string",
    ])
    expect(result.columns.some((column) => "typeRef" in column)).toBe(false)
    expect(result.rows[0][0]).toBe("192.0.2.1")
    const table = `metadata_${randomUUID().replaceAll("-", "")}`
    try {
      await env.admin.query(
        `CREATE TABLE public.${table} (mood public."${name}", label varchar(20))`,
      )
      value(await env.api.inspect("db"))
      const structure = (await env.api.sync()).connections[0].schema
        ?.find((schema) => schema.name === "public")
        ?.tables.find((entry) => entry.name === table)
      const browsed = value(
        await env.api.select("db", "view", randomUUID(), {
          from: { schema: "public", table },
        }),
      )
      expect(browsed.result.columns.map((column) => column.dbType)).toEqual(
        structure?.columns.map((column) => column.type) ?? [],
      )
    } finally {
      await env.admin.query(`DROP TABLE IF EXISTS public.${table}`)
    }
    await env.admin.query(
      `ALTER TYPE public."${name}" RENAME TO "${name}_renamed"`,
    )
    value(await env.api.inspect("db"))
    const renamed = value(
      await env.api.query(
        session,
        randomUUID(),
        `SELECT NULL::public."${name}_renamed"`,
      ),
    )
    expect(renamed.columns[0].dbType).toBe(`public."${name}_renamed"`)
  } finally {
    await env.admin.query(
      `DROP TYPE IF EXISTS public."${name}", public."${name}_renamed"`,
    )
    await env.close()
  }
})

test("uncommitted types stay unknown without querying or aborting the user's transaction", async () => {
  const env = await setup(profile("postgres"))
  const name = `Private_${randomUUID().replaceAll("-", "")}`
  try {
    const session = value(await env.api.openSession("db", "private"))
    value(await env.api.query(session, randomUUID(), "BEGIN"))
    value(
      await env.api.query(
        session,
        randomUUID(),
        `CREATE TYPE public."${name}" AS ENUM ('one')`,
      ),
    )
    const before = value(
      await env.api.query(
        session,
        randomUUID(),
        `SELECT 'one'::public."${name}" AS value`,
      ),
    )
    expect(before.rows).toEqual([["one"]])
    expect(before.columns[0].dbType).toBeUndefined()
    value(await env.api.query(session, randomUUID(), "COMMIT"))
    const after = value(
      await env.api.query(
        session,
        randomUUID(),
        `SELECT 'one'::public."${name}" AS value`,
      ),
    )
    expect(after.columns[0].dbType).toBe(`public."${name}"`)
  } finally {
    await env.admin.query(`DROP TYPE IF EXISTS public."${name}"`)
    await env.close()
  }
})
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
      expect(ascending.executedSql).toContain(`ORDER BY ${column} ASC`)
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
