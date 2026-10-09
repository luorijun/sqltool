import { expect, mock, test } from "bun:test"
import { connection, setup, value } from "@tests/support/backend"
import type { ConnectionSession } from "@/main/drivers"
import type { Confirm } from "@/main/sessions"

test("sessions connect lazily and opening the same tab reuses its session", async () => {
  const { api, clients } = setup()
  const first = value(await api.openSession("db", "a"))
  expect(value(await api.openSession("db", "a"))).toBe(first)
  expect(value(await api.openSession("db", "b"))).not.toBe(first)
  expect(clients).toHaveLength(0)
})
test("SQL sessions reuse their own connection and release it when their owner closes", async () => {
  const { api, database, clients } = setup()
  const a = value(await api.openSession("db", "a")),
    b = value(await api.openSession("db", "b"))
  value(await api.query(a, "begin", "BEGIN"))
  value(await api.query(b, "select", "SELECT 1"))
  value(await api.query(a, "rollback", "ROLLBACK"))
  expect(clients.map((entry) => entry.sql)).toEqual([
    ["BEGIN", "ROLLBACK"],
    ["SELECT 1"],
  ])
  await database.closeOwner(1, true)
  await Promise.all(clients.map((entry) => entry.closed.promise))
  expect((await api.sync()).sessions).toEqual([])
})
test("another window cannot see or execute a SQL session it does not own", async () => {
  const { api, database, clients } = setup()
  const id = value(await api.openSession("db", "a")),
    other = database.forOwner(2)
  expect((await other.query(id, "foreign", "DELETE FROM items")).ok).toBe(false)
  expect(clients).toHaveLength(0)
  expect((await other.sync()).sessions).toEqual([])
})
test("SQL errors preserve a ready session and permit a later query on the same connection", async () => {
  const { api, clients } = setup()
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "first", "SELECT 1"))
  const query = clients[0].client.query
  clients[0].client.query = async (sql) => {
    if (sql === "BAD SQL") throw new Error("syntax error")
    return query(sql)
  }
  expect((await api.query(id, "bad", "BAD SQL")).ok).toBe(false)
  expect((await api.sync()).sessions[0].status).toBe("ready")
  value(await api.query(id, "next", "SELECT 2"))
  expect(clients).toHaveLength(1)
  expect(clients[0].sql).toEqual(["SELECT 1", "SELECT 2"])
})
test("transport failure requires an explicit fresh session and never replays SQL", async () => {
  const { api, clients } = setup()
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "first", "SELECT 1"))
  clients[0].fail()
  expect((await api.query(id, "lost", "UPDATE items SET n = 1")).ok).toBe(false)
  expect((await api.sync()).sessions[0].status).toBe("failed")
  const fresh = value(await api.openSession("db", "a"))
  expect(fresh).not.toBe(id)
  expect(clients).toHaveLength(1)
  value(await api.query(fresh, "new", "SELECT 2"))
  expect(clients[1].sql).toEqual(["SELECT 2"])
})
test("closing during connection creation destroys the late connection without executing SQL", async () => {
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnectionSession>()
  const client = connection()
  const { api, database } = setup({
    connect: () => {
      started.resolve()
      return pending.promise
    },
  })
  const id = value(await api.openSession("db", "a"))
  const response = api.query(id, "request", "UPDATE items SET n = 1")
  try {
    await started.promise
    await database.closeOwner(1, true)
    expect((await response).ok).toBe(false)
    pending.resolve(client.client)
    await client.closed.promise
    expect(client.sql).toEqual([])
    expect((await api.sync()).sessions).toEqual([])
  } finally {
    pending.resolve(client.client)
    await response
  }
})
test("a failed connection requires only a force decision and is retained on refusal", async () => {
  let accepted = false
  const confirm = mock<Confirm>(async () => accepted)
  const { api, clients } = setup({ confirm })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "first", "SELECT 1"))
  clients[0].fail()
  expect(value(await api.closeTab("a"))).toBe(false)
  expect((await api.sync()).sessions[0].status).toBe("failed")
  expect(confirm.mock.calls.map((call) => call[3])).toEqual(["force"])
  accepted = true
  expect(value(await api.closeTab("a"))).toBe(true)
  expect(clients[0].sql).toEqual(["SELECT 1"])
})
