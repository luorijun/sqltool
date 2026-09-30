import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  pid,
  profile,
  query,
  setup,
  slowSql,
  value,
  waitClosed,
  waitRunning,
} from "./helpers"

describe.each(["postgres", "mysql"] as const)("%s database", (driver) => {
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

  test("cancelling a running query does not hit the next query or another session", async () => {
    const env = await setup(profile(driver))
    const { api, admin } = env
    try {
      const a = value(await api.openSession("db", "a"))
      const b = value(await api.openSession("db", "b"))
      const id = await pid(api, a, driver)
      const request = randomUUID()
      const running = api.query(a, request, slowSql(driver))
      try {
        await waitRunning(admin, driver, id)
        expect(Number((await query(api, b, "SELECT 23")).rows[0][0])).toBe(23)
        const next = api.query(a, randomUUID(), "SELECT 77")
        value(await api.cancel(request))
        expect(await running).toMatchObject({ ok: false, kind: "cancelled" })
        expect(Number(value(await next).rows[0][0])).toBe(77)
      } finally {
        await api.closeTab("a")
        await running
      }
    } finally {
      await env.close()
    }
  })

  test("transport loss during execution reports an unknown result and rebuilding loses temporary state", async () => {
    const env = await setup(profile(driver))
    const { api, admin } = env
    try {
      const a = value(await api.openSession("db", "a"))
      await query(api, a, "CREATE TEMPORARY TABLE old_temp (n INT)")
      const id = await pid(api, a, driver)
      const running = api.query(a, randomUUID(), slowSql(driver))
      try {
        await waitRunning(admin, driver, id)
        await admin.query(
          driver === "postgres"
            ? `SELECT pg_terminate_backend(${id})`
            : `KILL CONNECTION ${id}`,
        )
        expect(await running).toMatchObject({ ok: false, kind: "unknown" })
        expect((await api.query(a, randomUUID(), "SELECT 1")).ok).toBe(false)
        const fresh = value(await api.openSession("db", "a"))
        expect(fresh).not.toBe(a)
        expect(
          await api.query(fresh, randomUUID(), "SELECT * FROM old_temp"),
        ).toMatchObject({
          ok: false,
          kind: "error",
          error: expect.stringContaining("old_temp"),
        })
        expect(Number((await query(api, fresh, "SELECT 3")).rows[0][0])).toBe(3)
      } finally {
        await api.closeTab("a")
        await running
      }
    } finally {
      await env.close()
    }
  })

  test("targeted catalog refresh updates changed and dropped tables", async () => {
    const env = await setup(profile(driver))
    const { api, admin } = env
    const table = `catalog_${randomUUID().replaceAll("-", "")}`
    const source = { schema, table }
    const tables = async () =>
      (await api.sync()).connections[0].schema?.find(
        (entry) => entry.name === schema,
      )?.tables
    try {
      await admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
      value(await api.inspect("db"))
      await admin.query(`ALTER TABLE ${table} ADD COLUMN fresh TEXT`)
      value(await api.inspect("db", source, true))
      expect(
        (await tables())
          ?.find((entry) => entry.name === table)
          ?.columns.map((column) => column.name),
      ).toEqual(["id", "fresh"])
      await admin.query(`DROP TABLE ${table}`)
      value(await api.inspect("db", source, true))
      expect((await tables())?.some((entry) => entry.name === table)).toBe(
        false,
      )
    } finally {
      await env.close([table])
    }
  })
})
