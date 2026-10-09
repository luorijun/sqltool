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
} from "@tests/integration/helpers"
import { connectDriver } from "@/main/drivers"
import type { Confirm, ConfirmKind } from "@/main/sessions"

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
          expect(kinds).toEqual([])
          kinds.length = 0
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
        expect(kinds).toEqual(["rollback"])
        kinds.length = 0
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
        expect(kinds).toEqual(["rollback"])
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
          expect(kinds).toEqual(["rollback"])
          kinds.length = 0
        }
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

    test.each([
      ["without transaction", false],
      ["with transaction", true],
    ] as const)(
      "stopping a running query with an existing transaction %s reads the post-cancellation state",
      async (_case, transaction) => {
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

test("mysql recognizes implicit transactions and commits without creating a new transaction", async () => {
  const { kinds, confirm } = confirmations()
  const env = await setup(profile("mysql"), confirm)
  const tables = Array.from(
    { length: 3 },
    () => `implicit_${randomUUID().replaceAll("-", "")}`,
  )
  const [read, ddl, commit] = tables
  const cases: {
    tab: string
    table?: string
    sql: string[]
    kinds: ConfirmKind[]
    rows?: number
  }[] = [
    {
      tab: "read",
      table: read,
      sql: ["SET autocommit = 0", `SELECT * FROM ${read}`],
      kinds: ["rollback"],
    },
    {
      tab: "ddl",
      table: ddl,
      sql: [
        "BEGIN",
        `INSERT INTO ${ddl} VALUES (1)`,
        `ALTER TABLE ${ddl} ADD COLUMN extra INT`,
      ],
      kinds: [],
      rows: 1,
    },
    {
      tab: "commit",
      table: commit,
      sql: ["SET autocommit = 0", `INSERT INTO ${commit} VALUES (1)`, "COMMIT"],
      kinds: [],
      rows: 1,
    },
    {
      tab: "constant",
      sql: ["SET autocommit = 0", "SELECT 1"],
      kinds: [],
    },
  ]
  try {
    for (const entry of cases) {
      if (entry.table)
        await env.admin.query(
          `CREATE TABLE ${entry.table} (id INT PRIMARY KEY)`,
        )
      const session = value(await env.api.openSession("db", entry.tab))
      for (const sql of entry.sql) await query(env.api, session, sql)
      expect(value(await env.api.closeTab(entry.tab))).toBe(true)
      expect(kinds).toEqual(entry.kinds)
      kinds.length = 0
      if (entry.rows !== undefined) {
        expect(
          Number(
            (await env.admin.query(`SELECT COUNT(*) FROM ${entry.table}`))
              .rows[0][0],
          ),
        ).toBe(entry.rows)
      }
    }
  } finally {
    await env.close(tables)
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
