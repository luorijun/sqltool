import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync, randomUUID } from "node:crypto"
import net from "node:net"
import { type Connection, Server } from "ssh2"
import type { Config } from "../src/contracts/database"
import { connectDriver } from "../src/main/database/drivers"
import { Sessions } from "../src/main/database/sessions"

let ssh: Server
let sshPort: number
const transports = new Set<Connection>()
beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  ssh = new Server({ hostKeys: [privateKey] }, (client) => {
    transports.add(client)
    client.on("error", () => {})
    client.on("close", () => transports.delete(client))
    client.on("authentication", (ctx) => {
      if (
        ctx.method === "password" &&
        ctx.username === "sqltool" &&
        ctx.password === "test"
      )
        ctx.accept()
      else ctx.reject()
    })
    client.on("ready", () =>
      client.on("tcpip", (accept, reject, info) => {
        if (
          ![15432, 13306].includes(info.destPort) ||
          info.destIP !== "127.0.0.1"
        ) {
          reject()
          return
        }
        const socket = net.connect(info.destPort, "127.0.0.1")
        socket.on("error", () => {
          socket.destroy()
        })
        socket.once("connect", () => {
          const channel = accept()
          channel.on("error", () => socket.destroy())
          channel.on("close", () => socket.destroy())
          socket.on("error", () => channel.destroy())
          socket.pipe(channel).pipe(socket)
        })
      }),
    )
  })
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve))
  sshPort = (ssh.address() as net.AddressInfo).port
})
afterAll(async () => {
  for (const transport of transports) transport.end()
  await new Promise<void>((resolve) => ssh.close(() => resolve()))
})

for (const driver of ["postgres", "mysql"] as const) {
  for (const tunnel of [false, true]) {
    describe(`${driver} ${tunnel ? "SSH" : "direct"}`, () => {
      const profile = (): Config => ({
        id: "test",
        driver,
        host: "127.0.0.1",
        port: driver === "postgres" ? "15432" : "13306",
        username: "sqltool",
        password: "sqltool",
        database: "sqltool_test",
        createdAt: 0,
        updatedAt: 0,
        ...(tunnel
          ? {
              ssh: {
                host: "127.0.0.1",
                port: String(sshPort),
                username: "sqltool",
                auth: { type: "password", password: "test" },
              },
            }
          : {}),
      })
      const create = () =>
        new Sessions({
          connect: connectDriver,
          configs: () => [profile()],
          confirm: async () => true,
        })
      const query = (sessions: Sessions, id: string, sql: string) =>
        sessions.query(id, 1, randomUUID(), sql)
      const scalar = async (sessions: Sessions, id: string, sql: string) =>
        (await query(sessions, id, sql)).rows[0]?.[0]
      const schema = driver === "postgres" ? "public" : "sqltool_test"

      test("transactions, temporary tables, schema and browser are isolated", async () => {
        const sessions = create(),
          a = sessions.open("test", 1, "a"),
          b = sessions.open("test", 1, "b")
        const table = `session_test_${randomUUID().replaceAll("-", "")}`
        try {
          await query(sessions, b, `CREATE TABLE ${table} (id INT PRIMARY KEY)`)
          await query(sessions, a, "BEGIN")
          await query(sessions, a, `INSERT INTO ${table} VALUES (1)`)
          await query(sessions, b, `INSERT INTO ${table} VALUES (2)`)
          expect(
            Number(await scalar(sessions, a, `SELECT COUNT(*) FROM ${table}`)),
          ).toBe(2)
          expect(
            Number(await scalar(sessions, b, `SELECT COUNT(*) FROM ${table}`)),
          ).toBe(1)
          const browsed = await sessions.select(
            "test",
            1,
            "view",
            randomUUID(),
            {
              from: { schema, table },
              select: [{ aggregate: "count", alias: "n" }],
            },
          )
          expect(Number(browsed.result.rows[0][0])).toBe(1)
          await query(sessions, a, "ROLLBACK")
          expect(
            Number(await scalar(sessions, b, `SELECT COUNT(*) FROM ${table}`)),
          ).toBe(1)
          await query(sessions, a, "CREATE TEMPORARY TABLE own_temp (n INT)")
          await query(sessions, a, "INSERT INTO own_temp VALUES (42)")
          expect(
            Number(await scalar(sessions, a, "SELECT n FROM own_temp")),
          ).toBe(42)
          await expect(
            query(sessions, b, "SELECT n FROM own_temp"),
          ).rejects.toThrow()
          await query(sessions, a, "BEGIN")
          await expect(
            query(
              sessions,
              a,
              "SELECT * FROM definitely_missing_session_table",
            ),
          ).rejects.toThrow()
          await sessions.inspect("test", 1)
          expect(
            sessions
              .snapshot(1)
              .connections[0].schema?.some((s) => s.name === schema),
          ).toBe(true)
          await query(sessions, a, "ROLLBACK")
          await query(sessions, b, `DROP TABLE ${table}`)
          await sessions.disconnect("test", 1)
          expect(sessions.snapshot(1).connections[0].connected).toBe(false)
        } finally {
          await sessions.closeOwner(1, true)
        }
      })

      test("targeted structure refresh handles changed and dropped tables without refreshing neighbors", async () => {
        const sessions = create()
        const client = await connectDriver(profile())
        const name = `refresh_${randomUUID().replaceAll("-", "")}`
        const source = { schema, table: `${name}' quoted` }
        const quote = (name: string) =>
          driver === "postgres"
            ? `"${name.replaceAll('"', '""')}"`
            : `\`${name.replaceAll("`", "``")}\``
        const table = quote(source.table)
        const other = quote(name)
        try {
          await client.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
          await client.query(`CREATE TABLE ${other} (id INT PRIMARY KEY)`)
          await sessions.inspect("test", 1)
          await client.query(`ALTER TABLE ${table} ADD COLUMN fresh TEXT`)
          await client.query(`ALTER TABLE ${other} ADD COLUMN untouched TEXT`)
          const scoped = await client.inspect(source)
          expect(
            scoped
              .flatMap((schema) => schema.tables)
              .map((table) => table.name),
          ).toEqual([source.table])
          expect(
            scoped.flatMap((schema) => [...schema.views, ...schema.functions]),
          ).toHaveLength(0)
          await sessions.inspect("test", 1, source)
          const tables = sessions
            .snapshot(1)
            .connections[0].schema?.find((item) => item.name === schema)?.tables
          if (!tables) throw new Error("Missing refreshed tables")
          expect(
            tables
              .find((item) => item.name === source.table)
              ?.columns.map((column) => column.name),
          ).toEqual(["id", "fresh"])
          expect(
            tables
              .find((item) => item.name === name)
              ?.columns.map((column) => column.name),
          ).toEqual(["id"])
          await client.query(`DROP TABLE ${table}`)
          await sessions.inspect("test", 1, source)
          const after = sessions
            .snapshot(1)
            .connections[0].schema?.find((item) => item.name === schema)?.tables
          if (!after) throw new Error("Missing tables after refresh")
          expect(after.some((item) => item.name === source.table)).toBe(false)
          expect(after.some((item) => item.name === name)).toBe(true)
        } finally {
          try {
            await client.query(`DROP TABLE IF EXISTS ${table}`)
            await client.query(`DROP TABLE IF EXISTS ${other}`)
          } finally {
            await client.close()
            await sessions.closeOwner(1, true)
          }
        }
      })

      test("cancel slow query without hitting the next query; a different session stays usable", async () => {
        const sessions = create(),
          a = sessions.open("test", 1, "a"),
          b = sessions.open("test", 1, "b")
        try {
          await query(sessions, a, "SELECT 1")
          const requestId = randomUUID()
          const sql =
            driver === "postgres"
              ? "SELECT pg_sleep(15)"
              : "SELECT 1 WHERE SLEEP(15) = 0"
          const result = sessions.respond(1, () =>
            sessions.query(a, 1, requestId, sql),
          )
          await new Promise((resolve) => setTimeout(resolve, 200))
          expect(Number(await scalar(sessions, b, "SELECT 23"))).toBe(23)
          const next = sessions.respond(1, () =>
            query(sessions, a, "SELECT 77"),
          )
          await sessions.cancel(requestId, 1)
          const response = await result
          expect(response).toMatchObject({ ok: false, kind: "cancelled" })
          const following = await next
          expect(following.ok).toBe(true)
          if (following.ok) expect(Number(following.value.rows[0][0])).toBe(77)
          await sessions.disconnect("test", 1)
        } finally {
          await sessions.closeOwner(1, true)
        }
      })

      test("idle transport loss is detected; new session has a new identity and no old temporary state", async () => {
        const sessions = create(),
          id = sessions.open("test", 1, "a")
        const admin = await connectDriver(profile())
        try {
          await query(sessions, id, "CREATE TEMPORARY TABLE old_temp (n INT)")
          const pid = Number(
            await scalar(
              sessions,
              id,
              driver === "postgres"
                ? "SELECT pg_backend_pid()"
                : "SELECT CONNECTION_ID()",
            ),
          )
          await admin.query(
            driver === "postgres"
              ? `SELECT pg_terminate_backend(${pid})`
              : `KILL CONNECTION ${pid}`,
          )
          for (
            let i = 0;
            i < 50 && sessions.snapshot(1).sessions[0].status !== "failed";
            i++
          )
            await new Promise((r) => setTimeout(r, 10))
          expect(sessions.snapshot(1).sessions[0].status).toBe("failed")
          await expect(query(sessions, id, "SELECT 1")).rejects.toThrow()
          const fresh = sessions.open("test", 1, "a")
          expect(fresh).not.toBe(id)
          await expect(
            query(sessions, fresh, "SELECT * FROM old_temp"),
          ).rejects.toThrow()
          expect(Number(await scalar(sessions, fresh, "SELECT 3"))).toBe(3)
        } finally {
          await admin.close()
          await sessions.closeOwner(1, true)
        }
      })

      test("loss during execution reports an unknown result and invalidates the connection", async () => {
        const sessions = create(),
          id = sessions.open("test", 1, "a")
        const admin = await connectDriver(profile())
        try {
          const pid = Number(
            await scalar(
              sessions,
              id,
              driver === "postgres"
                ? "SELECT pg_backend_pid()"
                : "SELECT CONNECTION_ID()",
            ),
          )
          const running = sessions.respond(1, () =>
            query(
              sessions,
              id,
              driver === "postgres"
                ? "SELECT pg_sleep(15)"
                : "SELECT 1 WHERE SLEEP(15) = 0",
            ),
          )
          await new Promise((r) => setTimeout(r, 100))
          await admin.query(
            driver === "postgres"
              ? `SELECT pg_terminate_backend(${pid})`
              : `KILL CONNECTION ${pid}`,
          )
          const response = await running
          expect(response).toMatchObject({ ok: false, kind: "unknown" })
          expect(response.snapshot.sessions[0].status).toBe("failed")
        } finally {
          await admin.close()
          await sessions.closeOwner(1, true)
        }
      })

      if (tunnel)
        test("SSH transport failure invalidates idle sessions", async () => {
          const sessions = create(),
            id = sessions.open("test", 1, "a")
          const existing = new Set(transports)
          try {
            await query(sessions, id, "SELECT 1")
            for (const transport of transports)
              if (!existing.has(transport)) transport.end()
            for (
              let i = 0;
              i < 50 && sessions.snapshot(1).sessions[0].status !== "failed";
              i++
            )
              await new Promise((r) => setTimeout(r, 10))
            expect(sessions.snapshot(1).sessions[0].status).toBe("failed")
            await expect(query(sessions, id, "SELECT 2")).rejects.toThrow()
          } finally {
            await sessions.closeOwner(1, true)
          }
        })

      test("closing a tab rolls back its changes and releases only its own connection", async () => {
        const sessions = create(),
          a = sessions.open("test", 1, "a"),
          b = sessions.open("test", 1, "b")
        const table = `close_test_${randomUUID().replaceAll("-", "")}`
        try {
          await query(sessions, b, `CREATE TABLE ${table} (id INT PRIMARY KEY)`)
          await query(sessions, a, "BEGIN")
          await query(sessions, a, `INSERT INTO ${table} VALUES (1)`)
          const pid = Number(
            await scalar(
              sessions,
              a,
              driver === "postgres"
                ? "SELECT pg_backend_pid()"
                : "SELECT CONNECTION_ID()",
            ),
          )
          const running = sessions.respond(1, () =>
            query(
              sessions,
              a,
              driver === "postgres"
                ? "SELECT pg_sleep(15)"
                : "SELECT 1 WHERE SLEEP(15) = 0",
            ),
          )
          await new Promise((r) => setTimeout(r, 100))
          expect(await sessions.closeTab(1, "a")).toBe(true)
          expect(await running).toMatchObject({ ok: false, kind: "cancelled" })
          const check =
            driver === "postgres"
              ? `SELECT COUNT(*) FROM pg_stat_activity WHERE pid = ${pid}`
              : `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID = ${pid}`
          let remaining = 1
          for (let i = 0; i < 50 && remaining; i++) {
            remaining = Number(await scalar(sessions, b, check))
            if (remaining) await new Promise((r) => setTimeout(r, 10))
          }
          expect(remaining).toBe(0)
          expect(
            Number(await scalar(sessions, b, `SELECT COUNT(*) FROM ${table}`)),
          ).toBe(0)
          expect(
            sessions.snapshot(1).sessions.filter((s) => s.kind === "sql"),
          ).toHaveLength(1)
          await query(sessions, b, `DROP TABLE ${table}`)
        } finally {
          await sessions.closeOwner(1, true)
        }
      })
    })
  }
}
