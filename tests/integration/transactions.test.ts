import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { connectDriver } from "../../src/main/database"
import type { Confirm, ConfirmKind } from "../../src/main/database/ports"
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

function confirmations() {
  const kinds: ConfirmKind[] = []
  const confirm: Confirm = async (_owner, _message, _detail, kind) => {
    kinds.push(kind)
    return true
  }
  return { kinds, confirm }
}

describe.each(["postgres", "mysql"] as const)(
  "%s transaction closure",
  (driver) => {
    test("the driver reads the latest status after ordinary and transactional errors", async () => {
      const client = await connectDriver(profile(driver))
      try {
        expect(await client.transaction()).toBe("idle")
        await expect(client.query("BAD SQL")).rejects.toThrow()
        expect(await client.transaction()).toBe("idle")
        await client.query("BEGIN")
        expect(await client.transaction()).toBe("active")
        await expect(client.query("BAD SQL")).rejects.toThrow()
        expect(await client.transaction()).toBe(
          driver === "postgres" ? "failed" : "active",
        )
        await client.query("ROLLBACK")
        expect(await client.transaction()).toBe("idle")
        await client.query("BEGIN")
        await client.query("COMMIT")
        expect(await client.transaction()).toBe("idle")
      } finally {
        await client.close()
      }
    })

    test("ordinary SQL, autocommitted writes and completed transactions close without confirmation", async () => {
      const { kinds, confirm } = confirmations()
      const env = await setup(profile(driver), confirm)
      const table = `idle_${randomUUID().replaceAll("-", "")}`
      try {
        await env.admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
        const cases = [
          ["SELECT 1"],
          [`INSERT INTO ${table} VALUES (1)`],
          ["BEGIN", "SELECT 1", "COMMIT"],
          ["BEGIN", "SELECT 1", "ROLLBACK"],
        ]
        for (const [index, sql] of cases.entries()) {
          const tab = `idle-${index}`
          const id = value(await env.api.openSession("db", tab))
          for (const text of sql) await query(env.api, id, text)
          expect(value(await env.api.closeTab(tab))).toBe(true)
        }
        const id = value(await env.api.openSession("db", "bad"))
        expect(await env.api.query(id, randomUUID(), "BAD SQL")).toMatchObject({
          ok: false,
          kind: "error",
        })
        expect(value(await env.api.closeTab("bad"))).toBe(true)
        expect(kinds).toEqual([])
        expect(
          Number(
            (await env.admin.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0],
          ),
        ).toBe(1)
      } finally {
        await env.close([table])
      }
    })

    test("refusing rollback retains uncommitted rows; acceptance rolls them back and releases the connection", async () => {
      let accepted = false
      const kinds: ConfirmKind[] = []
      const env = await setup(
        profile(driver),
        async (_owner, _message, _detail, kind) => {
          kinds.push(kind)
          return accepted
        },
      )
      const table = `pending_${randomUUID().replaceAll("-", "")}`
      try {
        await env.admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
        const id = value(await env.api.openSession("db", "a"))
        await query(env.api, id, "BEGIN")
        await query(env.api, id, `INSERT INTO ${table} VALUES (1)`)
        const backend = await pid(env.api, id, driver)
        expect(value(await env.api.closeTab("a"))).toBe(false)
        expect(
          Number(
            (await query(env.api, id, `SELECT COUNT(*) FROM ${table}`))
              .rows[0][0],
          ),
        ).toBe(1)
        expect(
          Number(
            (await env.admin.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0],
          ),
        ).toBe(0)
        accepted = true
        expect(value(await env.api.closeTab("a"))).toBe(true)
        expect(kinds).toEqual(["rollback", "rollback"])
        await waitClosed(env.admin, driver, backend)
        expect(
          Number(
            (await env.admin.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0],
          ),
        ).toBe(0)
      } finally {
        await env.close([table])
      }
    })

    test("savepoint rollback and chained completion still leave a transaction to confirm", async () => {
      const { kinds, confirm } = confirmations()
      const env = await setup(profile(driver), confirm)
      try {
        const cases = [
          [
            "BEGIN",
            "SAVEPOINT own_point",
            "SELECT 1",
            "ROLLBACK TO SAVEPOINT own_point",
          ],
          ["BEGIN", "COMMIT AND CHAIN"],
          ["BEGIN", "ROLLBACK AND CHAIN"],
        ]
        for (const [index, sql] of cases.entries()) {
          const tab = `pending-${index}`
          const id = value(await env.api.openSession("db", tab))
          for (const text of sql) await query(env.api, id, text)
          expect(value(await env.api.closeTab(tab))).toBe(true)
        }
        expect(kinds).toEqual(["rollback", "rollback", "rollback"])
      } finally {
        await env.close()
      }
    })

    test("an error inside a transaction still requires rollback confirmation", async () => {
      const { kinds, confirm } = confirmations()
      const env = await setup(profile(driver), confirm)
      try {
        const id = value(await env.api.openSession("db", "a"))
        await query(env.api, id, "BEGIN")
        expect((await env.api.query(id, randomUUID(), "BAD SQL")).ok).toBe(
          false,
        )
        expect(value(await env.api.closeTab("a"))).toBe(true)
        expect(kinds).toEqual(["rollback"])
      } finally {
        await env.close()
      }
    })

    test.each([false, true])(
      "stopping a running query with an existing transaction %s reads the post-cancellation state",
      async (transaction) => {
        const { kinds, confirm } = confirmations()
        const env = await setup(profile(driver), confirm)
        let running: ReturnType<typeof env.api.query> | undefined
        try {
          const id = value(await env.api.openSession("db", "a"))
          if (transaction) await query(env.api, id, "BEGIN")
          const backend = await pid(env.api, id, driver)
          running = env.api.query(id, randomUUID(), slowSql(driver))
          await waitRunning(env.admin, driver, backend)
          expect(value(await env.api.closeTab("a"))).toBe(true)
          expect(await running).toMatchObject({ ok: false, kind: "cancelled" })
          expect(kinds).toEqual(transaction ? ["stop", "rollback"] : ["stop"])
          await waitClosed(env.admin, driver, backend)
        } finally {
          await env.close()
          await running
        }
      },
    )

    test("transport loss during SQL gets only an unknown-result force decision", async () => {
      const { kinds, confirm } = confirmations()
      const env = await setup(profile(driver), confirm)
      let running: ReturnType<typeof env.api.query> | undefined
      try {
        const id = value(await env.api.openSession("db", "a"))
        const backend = await pid(env.api, id, driver)
        running = env.api.query(id, randomUUID(), slowSql(driver))
        await waitRunning(env.admin, driver, backend)
        await env.admin.query(
          driver === "postgres"
            ? `SELECT pg_terminate_backend(${backend})`
            : `KILL CONNECTION ${backend}`,
        )
        expect(await running).toMatchObject({ ok: false, kind: "unknown" })
        expect(value(await env.api.closeTab("a"))).toBe(true)
        expect(kinds).toEqual(["force"])
      } finally {
        await env.close()
        await running
      }
    })
  },
)

test("mysql probes recognize implicit transactions and commits without creating a new transaction", async () => {
  const { kinds, confirm } = confirmations()
  const env = await setup(profile("mysql"), confirm)
  const table = `implicit_${randomUUID().replaceAll("-", "")}`
  try {
    await env.admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
    const a = value(await env.api.openSession("db", "a"))
    await query(env.api, a, "SET autocommit = 0")
    await query(env.api, a, `SELECT * FROM ${table}`)
    expect(value(await env.api.closeTab("a"))).toBe(true)
    expect(kinds).toEqual(["rollback"])
    kinds.length = 0

    const b = value(await env.api.openSession("db", "b"))
    await query(env.api, b, "BEGIN")
    await query(env.api, b, `INSERT INTO ${table} VALUES (1)`)
    await query(env.api, b, `ALTER TABLE ${table} ADD COLUMN extra INT`)
    expect(value(await env.api.closeTab("b"))).toBe(true)
    expect(kinds).toEqual([])
    expect(
      Number(
        (await env.admin.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0],
      ),
    ).toBe(1)

    const c = value(await env.api.openSession("db", "c"))
    await query(env.api, c, "SET autocommit = 0")
    await query(env.api, c, `INSERT INTO ${table} (id) VALUES (2)`)
    await query(env.api, c, "COMMIT")
    expect(value(await env.api.closeTab("c"))).toBe(true)
    expect(kinds).toEqual([])
    expect(
      Number(
        (await env.admin.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0],
      ),
    ).toBe(2)

    const d = value(await env.api.openSession("db", "d"))
    await query(env.api, d, "SET autocommit = 0")
    await query(env.api, d, "SELECT 1")
    expect(value(await env.api.closeTab("d"))).toBe(true)
    expect(kinds).toEqual([])
  } finally {
    await env.close([table])
  }
})

test("mysql detects the deadlock victim's server-side rollback instead of retaining old transaction state", async () => {
  const { kinds, confirm } = confirmations()
  const env = await setup(profile("mysql"), confirm)
  const table = `deadlock_${randomUUID().replaceAll("-", "")}`
  try {
    await env.admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY, n INT)`)
    await env.admin.query(`INSERT INTO ${table} VALUES (1, 0), (2, 0)`)
    const a = value(await env.api.openSession("db", "a"))
    const b = value(await env.api.openSession("db", "b"))
    await query(env.api, a, "BEGIN")
    await query(env.api, b, "BEGIN")
    await query(env.api, a, `UPDATE ${table} SET n = 1 WHERE id = 1`)
    await query(env.api, b, `UPDATE ${table} SET n = 2 WHERE id = 2`)
    const results = await Promise.all([
      env.api.query(a, randomUUID(), `UPDATE ${table} SET n = 1 WHERE id = 2`),
      env.api.query(b, randomUUID(), `UPDATE ${table} SET n = 2 WHERE id = 1`),
    ])
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    const victim = results.findIndex((r) => !r.ok)
    expect(results[victim]).toMatchObject({
      ok: false,
      error: expect.stringContaining("Deadlock"),
    })
    expect(value(await env.api.closeTab(victim === 0 ? "a" : "b"))).toBe(true)
    expect(kinds).toEqual([])
    expect(value(await env.api.closeTab(victim === 0 ? "b" : "a"))).toBe(true)
    expect(kinds).toEqual(["rollback"])
    expect(
      (await env.admin.query(`SELECT n FROM ${table} ORDER BY id`)).rows,
    ).toEqual([[0], [0]])
  } finally {
    await env.close([table])
  }
})
