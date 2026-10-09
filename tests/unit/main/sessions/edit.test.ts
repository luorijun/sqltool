import { expect, mock, test } from "bun:test"
import { connection } from "@tests/support/backend"
import { ConnError, type DbDriver } from "@/core/database"
import type { DriverResult, TableDefinition } from "@/main/drivers"
import { Results, selectSource } from "@/main/sessions/edit"

test("single-table eligibility preserves quoted identifiers and ignores literal SQL keywords", () => {
  expect(
    selectSource(
      'SELECT id, name AS title FROM "Public"."odd.table" AS t WHERE name=\'JOIN; SELECT\' ORDER BY id',
      "postgres",
    ),
  ).toEqual({ schema: "Public", table: "odd.table" })
  expect(
    selectSource("SELECT * FROM Items -- a comment\n LIMIT 3;", "postgres"),
  ).toEqual({ schema: "", table: "items" })
  expect(selectSource("SELECT * FROM `a``b`.`x.y`", "mysql")).toEqual({
    schema: "a`b",
    table: "x.y",
  })
})
test("joins, views through subqueries, aggregations and multi-statements are never auto-submitted", () => {
  for (const sql of [
    "SELECT a.* FROM items a JOIN items b ON a.id=b.id",
    "SELECT a.* FROM items a, items b",
    "WITH q AS (SELECT * FROM items) SELECT * FROM q",
    "SELECT id, count(*) FROM items GROUP BY id",
    "SELECT DISTINCT * FROM items",
    "SELECT * FROM items UNION SELECT * FROM items",
    "SELECT * FROM (SELECT * FROM items) q",
    "SELECT * FROM items WHERE id IN (SELECT id FROM other)",
    "SELECT * FROM items; UPDATE items SET id=3",
    "SELECT id, rank() OVER (ORDER BY id) FROM items",
    "SELECT * FROM items /*! UNION SELECT * FROM other */",
    "SELECT * FROM items WHERE label=$$FROM$$",
    "UPDATE items SET x=1 RETURNING *",
  ])
    expect(selectSource(sql, "postgres")).toBeNull()
})

function fixture(driver: DbDriver = "postgres") {
  const results = new Results()
  const { client } = connection()
  const definition: TableDefinition = {
    source: { schema: "public", table: "items" },
    columns: [
      { name: "tenant", key: true, generated: false },
      { name: "id", key: true, generated: false },
      { name: "label", key: false, generated: false },
      { name: "doubled", key: false, generated: true },
    ],
  }
  const result: DriverResult = {
    columns: definition.columns.map((column) => ({
      id: column.name,
      name: column.name === "label" ? "title" : column.name,
      schema: "public",
      table: "items",
      sourceColumn: column.name,
      typeFamily: column.name === "label" ? "string" : "number",
    })),
    rows: [
      [1, 2, "before", 4],
      [1, 3, "other", 6],
    ],
  }
  client.describe = async () => definition
  const readbacks: unknown[][][] = []
  const query = mock<typeof client.query>(async (sql) => {
    if (sql.startsWith("SELECT")) {
      const rows = readbacks.shift()
      if (!rows) throw new Error("Unexpected readback")
      return { columns: result.columns, rows }
    }
    return { columns: [], rows: [], rowCount: 1 }
  })
  client.query = query
  const capture = async (tabId = "tab") => {
    const captured = await results.capture(
      client,
      "session",
      1,
      tabId,
      driver,
      "SELECT * FROM public.items",
      result,
    )
    if (!captured.edit) throw new Error("Missing edit info")
    return captured.edit
  }
  return { results, client, definition, result, readbacks, query, capture }
}

test("writeback requires every composite key and excludes generated fields", async () => {
  const env = fixture()
  const edit = await env.capture()
  expect(edit.keys).toEqual(["tenant", "id"])
  expect(edit.writable).toEqual(["tenant", "id", "label"])
  env.result.columns = env.result.columns.filter((c) => c.id !== "tenant")
  const missing = await env.capture()
  expect(missing.source).toBeUndefined()
  expect(missing.reason).toContain("完整主键")
  expect(() => env.results.session(edit.id, 1, "tab")).toThrow("失效")
})

test.each(["postgres", "mysql"] as const)(
  "%s updates aliases with bound values and original keys, then retains the readback",
  async (driver) => {
    const env = fixture(driver)
    const edit = await env.capture()
    env.readbacks.push([env.result.rows[0]], [[1, 4, "normalized", 8]])
    const value = "new'; --"
    const saved = await env.results.save(env.client, edit.id, 1, "tab", [
      { row: 0, column: "id", value: 4 },
      { row: 0, column: "label", value },
    ])
    const update = env.query.mock.calls.find(([sql]) =>
      sql.startsWith("UPDATE"),
    )
    expect(update?.[0]).not.toContain(value)
    expect(update?.[0]).not.toContain("title")
    expect(update?.[1]).toEqual([4, value, 1, 2])
    const readback = env.query.mock.calls
      .filter(([sql]) => sql.startsWith("SELECT"))
      .at(-1)
    expect(readback?.[1]).toEqual([1, 4])
    expect(saved).toEqual({
      rows: [{ row: 0, values: [1, 4, "normalized", 8] }],
      transaction: false,
    })
    expect(env.result.rows[0]).toEqual([1, 4, "normalized", 8])
    expect(env.query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  },
)

test("existing transactions use a savepoint and never commit the caller's transaction", async () => {
  const env = fixture()
  env.client.transaction = async () => "active"
  const edit = await env.capture()
  env.query.mockClear()
  env.readbacks.push([env.result.rows[0]], [[1, 2, "inside", 4]])
  const saved = await env.results.save(env.client, edit.id, 1, "tab", [
    { row: 0, column: "label", value: "inside" },
  ])
  expect(saved.transaction).toBe(true)
  expect(env.query.mock.calls[0][0]).toMatch(/^SAVEPOINT sqltool_edit_/)
  expect(env.query.mock.calls.at(-1)?.[0]).toMatch(
    /^RELEASE SAVEPOINT sqltool_edit_/,
  )
  expect(env.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT")
})

test("a conflict in a later row rolls back the batch and preserves every baseline row", async () => {
  const env = fixture()
  const edit = await env.capture()
  const before = structuredClone(env.result.rows)
  env.readbacks.push([before[0]], [[1, 2, "first", 4]], [[1, 3, "external", 6]])
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", [
      { row: 0, column: "label", value: "first" },
      { row: 1, column: "label", value: "second" },
    ]),
  ).rejects.toThrow("已被修改")
  expect(env.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  expect(env.result.rows).toEqual(before)
})

test("uncertain commits preserve the baseline and cannot be retried", async () => {
  const env = fixture()
  const edit = await env.capture()
  env.readbacks.push([env.result.rows[0]], [[1, 2, "after", 4]])
  const query = env.client.query
  env.client.query = async (sql, params) => {
    if (sql === "COMMIT") throw new ConnError("lost commit", "unknown")
    return query(sql, params)
  }
  const changes = [{ row: 0, column: "label", value: "after" }]
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", changes),
  ).rejects.toThrow("lost commit")
  expect(env.result.rows[0][2]).toBe("before")
  env.query.mockClear()
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", changes),
  ).rejects.toThrow("不能直接重试")
  expect(env.query).not.toHaveBeenCalled()
})

test("result ownership, stale sessions and local-only cells are rejected before any SQL", async () => {
  const env = fixture()
  const edit = await env.capture()
  const changes = [{ row: 0, column: "label", value: "after" }]
  await expect(
    env.results.save(env.client, edit.id, 2, "tab", changes),
  ).rejects.toThrow("失效")
  await expect(
    env.results.save(env.client, edit.id, 1, "other", changes),
  ).rejects.toThrow("失效")
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", [
      { row: 0, column: "doubled", value: 8 },
    ]),
  ).rejects.toThrow("无法写回")
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", [...changes, ...changes]),
  ).rejects.toThrow("重复")
  env.results.forget("session")
  await expect(
    env.results.save(env.client, edit.id, 1, "tab", changes),
  ).rejects.toThrow("失效")
  expect(env.query).not.toHaveBeenCalled()
})

test("schema changes and deleted rows roll back without changing the baseline", async () => {
  for (const reason of ["schema", "deleted"] as const) {
    const env = fixture()
    const edit = await env.capture()
    if (reason === "schema")
      env.client.describe = async () => ({ ...env.definition, columns: [] })
    else env.readbacks.push([])
    await expect(
      env.results.save(env.client, edit.id, 1, "tab", [
        { row: 0, column: "label", value: "after" },
      ]),
    ).rejects.toThrow(reason === "schema" ? "表结构已变化" : "已删除")
    expect(env.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(env.result.rows[0][2]).toBe("before")
  }
})
