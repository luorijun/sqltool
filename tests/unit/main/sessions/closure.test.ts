import { expect, mock, test } from "bun:test"
import { result, setup, value } from "@tests/support/backend"
import type { DriverResult } from "@/main/drivers"
import type { Confirm } from "@/main/sessions"

test("declining closure preserves the session; a failed rollback needs a separate force decision", async () => {
  const decisions = [false, true, false, true, true]
  const { api, clients } = setup({
    confirm: async () => decisions.shift() ?? false,
  })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "begin", "BEGIN"))
  expect(value(await api.closeTab("a"))).toBe(false)
  value(await api.query(id, "still-open", "SELECT 1"))
  clients[0].client.query = async () => {
    throw new Error("rollback failed")
  }
  expect(value(await api.closeTab("a"))).toBe(false)
  expect((await api.sync()).sessions[0].error).toBe("rollback failed")
  expect(value(await api.closeTab("a"))).toBe(true)
  await clients[0].closed.promise
  expect((await api.sync()).sessions).toEqual([])
})

test.each(["SELECT 1", "COMMIT", "ROLLBACK"])(
  "closing an idle session after %s needs neither confirmation nor rollback",
  async (sql) => {
    const confirm = mock<Confirm>(async () => true)
    const { api, clients } = setup({ confirm })
    const id = value(await api.openSession("db", "a"))
    if (sql !== "SELECT 1") value(await api.query(id, "begin", "BEGIN"))
    value(await api.query(id, "last", sql))
    expect(value(await api.closeTab("a"))).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(clients[0].sql.at(-1)).toBe(sql)
  },
)

test("a failed ordinary query does not invent a transaction", async () => {
  const confirm = mock<Confirm>(async () => true)
  const { api, clients } = setup({ confirm })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "first", "SELECT 1"))
  clients[0].client.query = async () => {
    throw new Error("syntax error")
  }
  expect((await api.query(id, "bad", "BAD SQL")).ok).toBe(false)
  expect(value(await api.closeTab("a"))).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
})

test.each(["active", "failed"] as const)(
  "closing a %s transaction confirms rollback and preserves it on refusal",
  async (state) => {
    let accepted = false
    const confirm = mock<Confirm>(async () => accepted)
    const { api, clients } = setup({ confirm })
    const id = value(await api.openSession("db", "a"))
    value(await api.query(id, "begin", "BEGIN"))
    clients[0].client.transaction = async () => state
    expect(value(await api.closeTab("a"))).toBe(false)
    expect(clients[0].sql).toEqual(["BEGIN"])
    expect(confirm.mock.calls[0][3]).toBe("rollback")
    value(await api.query(id, "still-open", "SELECT 1"))
    accepted = true
    expect(value(await api.closeTab("a"))).toBe(true)
    expect(clients[0].sql.at(-1)).toBe("ROLLBACK")
  },
)

test("batch closure confirms once and rolls back only unfinished transactions", async () => {
  const confirm = mock<Confirm>(async () => true)
  const { api, clients } = setup({ confirm })
  for (const tab of ["a", "b", "c"]) {
    const id = value(await api.openSession("db", tab))
    value(await api.query(id, tab, tab === "c" ? "SELECT 1" : "BEGIN"))
  }
  expect(value(await api.disconnect("db"))).toBe(true)
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(confirm.mock.calls[0][3]).toBe("rollback")
  expect(clients.map((c) => c.sql)).toEqual([
    ["BEGIN", "ROLLBACK"],
    ["BEGIN", "ROLLBACK"],
    ["SELECT 1"],
  ])
})

test("unknown transaction status gets its own confirmation before attempting rollback", async () => {
  const confirm = mock<Confirm>(async () => true)
  const { api, clients } = setup({ confirm })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "first", "SELECT 1"))
  clients[0].client.transaction = async () => "unknown"
  expect(value(await api.closeTab("a"))).toBe(true)
  expect(confirm.mock.calls.map((call) => call[3])).toEqual(["unknown"])
  expect(clients[0].sql).toEqual(["SELECT 1", "ROLLBACK"])
})

test("status retrieval failure cannot silently close or roll back another session", async () => {
  const confirm = mock<Confirm>(async () => false)
  const { api, clients } = setup({ confirm })
  for (const tab of ["a", "b"]) {
    const id = value(await api.openSession("db", tab))
    value(await api.query(id, tab, "SELECT 1"))
  }
  clients[0].client.transaction = async () => {
    throw new Error("status unavailable")
  }
  expect(value(await api.disconnect("db"))).toBe(false)
  expect(confirm.mock.calls[0][3]).toBe("force")
  expect(clients.map((c) => c.sql)).toEqual([["SELECT 1"], ["SELECT 1"]])
  expect((await api.sync()).sessions.every((s) => s.status === "ready")).toBe(
    true,
  )
})

test("connection loss during rollback confirmation requires a separate force decision", async () => {
  const kinds: string[] = []
  const { api, clients } = setup({
    confirm: async (_owner, _message, _detail, kind) => {
      kinds.push(kind)
      if (kind === "rollback") clients[0].fail()
      return kind === "rollback"
    },
  })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "begin", "BEGIN"))
  expect(value(await api.closeTab("a"))).toBe(false)
  expect(kinds).toEqual(["rollback", "force"])
  expect(clients[0].sql).toEqual(["BEGIN"])
})

test("declining stop leaves running SQL untouched and resumes the queued SQL", async () => {
  const deciding = Promise.withResolvers<void>()
  const decision = Promise.withResolvers<boolean>()
  const confirm = mock<Confirm>(async () => {
    deciding.resolve()
    return decision.promise
  })
  const { api, clients } = setup({ confirm })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "initial", "SELECT 1"))
  const slow = Promise.withResolvers<DriverResult>()
  const started = Promise.withResolvers<void>()
  const query = clients[0].client.query
  const cancel = mock(async () => {})
  clients[0].client.cancel = cancel
  clients[0].client.query = async (sql) => {
    if (sql !== "SLOW") return query(sql)
    started.resolve()
    return slow.promise
  }
  const running = api.query(id, "slow", "SLOW")
  await started.promise
  const queued = api.query(id, "queued", "BEGIN")
  const closing = api.closeTab("a")
  try {
    await deciding.promise
    expect(confirm.mock.calls[0][3]).toBe("stop")
    slow.resolve(result)
    value(await running)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(clients[0].sql).toEqual(["SELECT 1"])
    expect((await api.query(id, "blocked", "SELECT 2")).ok).toBe(false)
    decision.resolve(false)
    expect(value(await closing)).toBe(false)
    value(await queued)
    expect(clients[0].sql).toEqual(["SELECT 1", "BEGIN"])
    expect(cancel).not.toHaveBeenCalled()
  } finally {
    slow.resolve(result)
    decision.resolve(false)
    await Promise.allSettled([running, queued, closing])
  }
})

test.each([
  ["accepted", true],
  ["declined", false],
] as const)(
  "after stopping SQL, rollback decision %s cannot run queued SQL or replay the cancelled query",
  async (_case, accepted) => {
    const confirm = mock<Confirm>(
      async (_owner, _message, _detail, kind) => kind === "stop" || accepted,
    )
    const { api, clients } = setup({ confirm })
    const id = value(await api.openSession("db", "a"))
    value(await api.query(id, "begin", "BEGIN"))
    const slow = Promise.withResolvers<DriverResult>()
    const started = Promise.withResolvers<void>()
    const query = clients[0].client.query
    clients[0].client.query = async (sql) => {
      if (sql !== "SLOW") return query(sql)
      started.resolve()
      return slow.promise
    }
    clients[0].client.cancel = async () => {
      slow.reject(new Error("cancelled"))
    }
    const running = api.query(id, "slow", "SLOW")
    await started.promise
    const queued = api.query(id, "queued", "INSERT INTO items VALUES (1)")
    try {
      expect(value(await api.closeTab("a"))).toBe(accepted)
      expect((await running).ok).toBe(false)
      expect(await queued).toMatchObject({ ok: false, kind: "cancelled" })
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([
        "stop",
        "rollback",
      ])
      expect(clients[0].sql).toEqual(
        accepted ? ["BEGIN", "ROLLBACK"] : ["BEGIN"],
      )
      if (!accepted) value(await api.query(id, "usable", "SELECT 1"))
    } finally {
      slow.resolve(result)
      await Promise.allSettled([running, queued])
    }
  },
)

test("a stop failure requires force confirmation without losing the running result", async () => {
  const confirm = mock<Confirm>(
    async (_owner, _message, _detail, kind) => kind === "stop",
  )
  const { api, clients } = setup({ confirm })
  const id = value(await api.openSession("db", "a"))
  value(await api.query(id, "initial", "SELECT 1"))
  const slow = Promise.withResolvers<DriverResult>()
  const started = Promise.withResolvers<void>()
  const query = clients[0].client.query
  clients[0].client.query = async (sql) => {
    if (sql !== "SLOW") return query(sql)
    started.resolve()
    return slow.promise
  }
  clients[0].client.cancel = async () => {
    throw new Error("cancel denied")
  }
  const running = api.query(id, "slow", "SLOW")
  try {
    await started.promise
    expect(value(await api.closeTab("a"))).toBe(false)
    expect(confirm.mock.calls.map((call) => call[3])).toEqual(["stop", "force"])
    slow.resolve(result)
    value(await running)
    value(await api.query(id, "usable", "SELECT 1"))
  } finally {
    slow.resolve(result)
    await running
  }
})
