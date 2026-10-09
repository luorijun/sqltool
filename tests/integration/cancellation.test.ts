import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  pid,
  profile,
  query,
  setup,
  slowSql,
  value,
  waitRunning,
} from "@tests/integration/helpers"

describe.each(["postgres", "mysql"] as const)("%s cancellation", (driver) => {
  test("cancelling a running query preserves the queued query and leaves another session usable", async () => {
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

        const next = api.query(a, randomUUID(), "SELECT 77")
        value(await api.cancel(request))
        expect(await running).toMatchObject({ ok: false, kind: "cancelled" })
        expect(Number(value(await next).rows[0][0])).toBe(77)
        expect(Number((await query(api, b, "SELECT 23")).rows[0][0])).toBe(23)
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
})
