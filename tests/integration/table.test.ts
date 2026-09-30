import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { profile, setup, value } from "./helpers"

test("MySQL resolves actual protocol types, including empty results and expressions", async () => {
  const env = await setup(profile("mysql"))
  try {
    const session = value(await env.api.openSession("db", "types"))
    const query = async (sql: string) =>
      value(await env.api.query(session, randomUUID(), sql))
    await query(`CREATE TEMPORARY TABLE type_probe (
      text_bin varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
      bytes varbinary(20), fixed_text char(5), fixed_bytes binary(5),
      amount decimal(8,2), positive decimal(8,2) unsigned,
      choice enum('a','b'), choices set('a','b'),
      small_text tinytext, normal_text text, medium_text mediumtext, large_text longtext,
      small_blob tinyblob, normal_blob blob, medium_blob mediumblob, large_blob longblob,
      bits bit(7), instant datetime(3), duration time(6), stamp timestamp(3),
      positive_int int unsigned, small_int tinyint(1), doc json
    )`)
    const result = await query("SELECT * FROM type_probe LIMIT 0")
    expect(result.rows).toEqual([])
    expect(result.columns.map((column) => column.dbType)).toEqual([
      "varchar(20)",
      "varbinary(20)",
      "char(5)",
      "binary(5)",
      "decimal(8,2)",
      "decimal(8,2) unsigned",
      "enum",
      "set",
      "tinytext",
      "text",
      "mediumtext",
      "longtext",
      "tinyblob",
      "blob",
      "mediumblob",
      "longblob",
      "bit(7)",
      "datetime(3)",
      "time(6)",
      "timestamp(3)",
      "int unsigned",
      "tinyint",
      "json",
    ])
    expect(
      result.columns.slice(0, 8).map((column) => column.typeFamily),
    ).toEqual([
      "string",
      "binary",
      "string",
      "binary",
      "decimal",
      "decimal",
      "string",
      "string",
    ])
    expect(result.columns.some((column) => "typeRef" in column)).toBe(false)
    const computed = await query(`SELECT CAST(1.23 AS DECIMAL(8,2)) AS amount,
      CAST('abc' AS CHAR(20) CHARACTER SET utf8mb4) AS label,
      NULL AS empty_value, 1+1 AS total, CURRENT_TIMESTAMP(3) AS instant`)
    expect(computed.columns.map((column) => column.dbType)).toEqual([
      "decimal(8,2)",
      "varchar(20)",
      "null",
      "bigint",
      "datetime(3)",
    ])
    await query("SET character_set_results = latin1")
    const converted = await query(
      "SELECT text_bin, normal_text FROM type_probe LIMIT 0",
    )
    expect(converted.columns.map((column) => column.dbType)).toEqual([
      "varchar(20)",
      "text",
    ])
  } finally {
    await env.close()
  }
})

test("MySQL result types follow casts and temporary tables, never cached source definitions", async () => {
  const env = await setup(profile("mysql"))
  const table = `types_${randomUUID().replaceAll("-", "")}`
  try {
    await env.admin.query(`CREATE TABLE ${table} (value varchar(100))`)
    value(await env.api.inspect("db"))
    const session = value(await env.api.openSession("db", "types"))
    const query = async (sql: string) =>
      value(await env.api.query(session, randomUUID(), sql))
    await query(`CREATE TEMPORARY TABLE ${table} (value decimal(8,2))`)
    const actual = await query(
      `SELECT value, CAST(value AS CHAR(10)) AS converted FROM ${table} LIMIT 0`,
    )
    expect(actual.columns.map((column) => column.dbType)).toEqual([
      "decimal(8,2)",
      "varchar(10)",
    ])
    const browsed = value(
      await env.api.select("db", "browse", randomUUID(), {
        from: { schema: "sqltool_test", table },
        limit: 0,
      }),
    )
    expect(browsed.result.columns[0].dbType).toBe("varchar(100)")
  } finally {
    await env.close([table])
  }
})

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
    value(await env.api.inspect("db", undefined, true))
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
