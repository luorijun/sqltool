import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  pid,
  profile,
  query,
  setup,
  value,
  waitClosed,
} from "@tests/integration/helpers"

describe.each(["postgres", "mysql"] as const)("%s isolation", (driver) => {
  const schema = driver === "postgres" ? "public" : "sqltool_test"
  test("transactions and temporary tables are isolated; closing rolls back and releases the connection", async () => {
    const env = await setup(profile(driver))
    const { api, admin } = env
    const table = `isolation_${randomUUID().replaceAll("-", "")}`
    try {
      await admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
      const a = value(await api.openSession("db", "a"))
      const b = value(await api.openSession("db", "b"))
      await query(api, a, "BEGIN")
      await query(api, a, `INSERT INTO ${table} VALUES (1)`)
      expect(
        Number(
          (await query(api, a, `SELECT COUNT(*) FROM ${table}`)).rows[0][0],
        ),
      ).toBe(1)
      expect(
        Number(
          (await query(api, b, `SELECT COUNT(*) FROM ${table}`)).rows[0][0],
        ),
      ).toBe(0)
      const browsed = value(
        await api.select("db", "view", randomUUID(), {
          from: { schema, table },
          select: [{ aggregate: "count", alias: "n" }],
        }),
      )
      expect(Number(browsed.result.rows[0][0])).toBe(0)
      await query(api, a, "CREATE TEMPORARY TABLE own_temp (n INT)")
      await query(api, a, "INSERT INTO own_temp VALUES (42)")
      expect(
        Number((await query(api, a, "SELECT n FROM own_temp")).rows[0][0]),
      ).toBe(42)
      expect(
        await api.query(b, randomUUID(), "SELECT n FROM own_temp"),
      ).toMatchObject({
        ok: false,
        kind: "error",
        error: expect.stringContaining("own_temp"),
      })
      const id = await pid(api, a, driver)
      expect(value(await api.closeTab("a"))).toBe(true)
      await waitClosed(admin, driver, id)
      expect(
        Number(
          (await query(api, b, `SELECT COUNT(*) FROM ${table}`)).rows[0][0],
        ),
      ).toBe(0)
      expect(
        (await api.sync()).sessions.some(
          (session) => session.id === b && session.status === "ready",
        ),
      ).toBe(true)
    } finally {
      await env.close([table])
    }
  })
})
