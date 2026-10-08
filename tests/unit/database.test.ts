import { afterEach, describe, expect, mock, test } from "bun:test"
import type {
  Config,
  ConnResponse,
  QueryResult,
} from "../../src/contracts/database"
import { createDatabase } from "../../src/main/database"
import type {
  ColumnType,
  Confirm,
  ConnectionSession,
  DatabaseOptions,
  DriverResult,
} from "../../src/main/database/ports"

const config: Config = {
  id: "db",
  driver: "postgres",
  host: "localhost",
  port: "5432",
  username: "u",
  password: "p",
  database: "db",
  createdAt: 0,
  updatedAt: 0,
}
const result: QueryResult = { columns: [], rows: [], rowCount: 0 }
const databases: ReturnType<typeof createDatabase>[] = []
function value<T>(response: ConnResponse<T>): T {
  if (response.ok === false) throw new Error(response.error)
  return response.value
}
function connection() {
  const sql: string[] = []
  const closed = Promise.withResolvers<void>()
  let fail: (error: Error) => void = () => {}
  let state: Awaited<ReturnType<ConnectionSession["transaction"]>> = "idle"
  const client: ConnectionSession = {
    transaction: async () => state,
    query: async (text) => {
      sql.push(text)
      if (text === "BEGIN") state = "active"
      if (text === "COMMIT" || text === "ROLLBACK") state = "idle"
      return result
    },
    inspect: async () => [
      { name: "public", tables: [], views: [], functions: [] },
    ],
    select: async () => {
      throw new Error("Unexpected select")
    },
    close: async () => closed.resolve(),
    destroy: () => closed.resolve(),
    cancel: async () => {},
    onFailure: (listener) => {
      fail = listener
      return () => {
        fail = () => {}
      }
    },
  }
  return { client, sql, closed, fail: () => fail(new Error("connection lost")) }
}
function setup(
  options: Partial<Pick<DatabaseOptions, "connect" | "confirm">> = {},
) {
  const entries = new Map([[config.id, { ...config }]])
  const clients: ReturnType<typeof connection>[] = []
  const database = createDatabase({
    store: {
      list: () => [...entries.values()],
      get: (id) => entries.get(id),
      set: (entry) => {
        entries.set(entry.id, entry)
      },
      remove: (id) => {
        entries.delete(id)
      },
    },
    connect: async () => {
      const client = connection()
      clients.push(client)
      return client.client
    },
    confirm: async () => true,
    ...options,
  })
  databases.push(database)
  return { database, api: database.forOwner(1), clients, entries }
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.closeOwner(1, true)))
})

describe("database service", () => {
  test("structure consumers queue behind one load and use its completed cache", async () => {
    const started = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    const inspect = mock(async () => {
      started.resolve()
      await ready.promise
      return []
    })
    const connect = mock(async () => ({ ...connection().client, inspect }))
    const { api, database } = setup({ connect })
    const first = api.inspect("db")
    try {
      await started.promise
      const second = database.forOwner(2).inspect("db")
      const third = api.inspect("db")
      ready.resolve()
      for (const response of await Promise.all([first, second, third])) {
        value(response)
        expect(response.snapshot.connections[0].schema).toEqual([])
      }
      value(await api.inspect("db"))
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(connect).toHaveBeenCalledTimes(1)
      expect(
        (await api.sync()).sessions.map((session) => session.kind),
      ).toEqual(["schema"])
    } finally {
      ready.resolve()
      await first
      await database.closeOwner(2, true)
    }
  })

  test("a queued consumer sees a refresh; targeted refresh without a cache loads the full structure", async () => {
    const started = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    let reads = 0
    const inspect = mock(async () => {
      reads++
      if (reads === 2) {
        started.resolve()
        await ready.promise
      }
      return [{ name: `schema_${reads}`, tables: [], views: [], functions: [] }]
    })
    const { api } = setup({
      connect: async () => ({ ...connection().client, inspect }),
    })
    value(await api.inspect("db", { schema: "app", table: "users" }, true))
    expect(inspect).toHaveBeenLastCalledWith(undefined)
    const refresh = api.inspect("db", undefined, true)
    try {
      await started.promise
      const consumer = api.inspect("db")
      ready.resolve()
      value(await refresh)
      const response = await consumer
      value(response)
      expect(response.snapshot.connections[0].schema?.[0].name).toBe("schema_2")
      expect(reads).toBe(2)
    } finally {
      ready.resolve()
      await refresh
    }
  })

  test("failed structure reads can retry and disconnect clears the shared cache", async () => {
    let reads = 0
    const inspect = mock(async () => {
      if (++reads === 1) throw new Error("structure unavailable")
      return [{ name: "app", tables: [], views: [], functions: [] }]
    })
    const connect = mock(async () => ({ ...connection().client, inspect }))
    const { api } = setup({ connect })
    expect((await api.inspect("db")).ok).toBe(false)
    value(await api.inspect("db"))
    expect(reads).toBe(2)
    value(await api.disconnect("db"))
    expect((await api.sync()).connections[0].schema).toBeNull()
    value(await api.inspect("db"))
    expect(reads).toBe(3)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  test("concurrent window closure releases the last shared metadata connection", async () => {
    const { api, database, clients } = setup()
    value(await api.connect("db"))
    value(await database.forOwner(2).connect("db"))
    expect(clients).toHaveLength(1)
    const destroy = mock(clients[0].client.destroy)
    clients[0].client.destroy = destroy
    await Promise.all([
      database.closeOwner(1, true),
      database.closeOwner(2, true),
    ])
    expect(destroy).toHaveBeenCalledTimes(1)
    expect((await api.sync()).connections[0].sessionCount).toBe(0)
  })

  test("concurrent metadata reads wait for the dedicated connection's initialization", async () => {
    const ready = Promise.withResolvers<void>()
    const preparing = Promise.withResolvers<void>()
    const queried = Promise.withResolvers<void>()
    const reads = mock(async () => [
      { dbType: "inet", typeFamily: "string" as const },
    ])
    const { api } = setup({
      connect: async () => {
        const entry = connection()
        entry.client.prepareMetadata = async () => {
          preparing.resolve()
          await ready.promise
        }
        entry.client.types = reads
        entry.client.query = async () => {
          queried.resolve()
          return {
            columns: [
              {
                id: "ip",
                name: "ip",
                typeFamily: "unknown",
                typeRef: { driver: "postgres", oid: 869, modifier: -1 },
              },
            ],
            rows: [],
          }
        }
        return entry.client
      },
    })
    const connecting = api.connect("db")
    let query: ReturnType<typeof api.query> | undefined
    try {
      await preparing.promise
      const session = value(await api.openSession("db", "a"))
      query = api.query(session, "query", "SELECT ip")
      await queried.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(reads).not.toHaveBeenCalled()
      ready.resolve()
      value(await connecting)
      expect(value(await query).columns[0].dbType).toBe("inet")
    } finally {
      ready.resolve()
      await Promise.all([connecting, query])
    }
  })

  test("metadata is shared across windows and a cancelled consumer does not cancel other lookups", async () => {
    const pending = Promise.withResolvers<Array<ColumnType | null>>()
    const started = Promise.withResolvers<void>()
    const reads = mock(() => {
      started.resolve()
      return pending.promise
    })
    const opened: Array<
      ReturnType<typeof connection> & { destroy: ReturnType<typeof mock> }
    > = []
    const typed: DriverResult = {
      columns: [
        {
          id: "ip",
          name: "ip",
          typeFamily: "unknown",
          typeCode: 869,
          typeRef: { driver: "postgres", oid: 869, modifier: -1 },
        },
      ],
      rows: [["192.0.2.1"]],
    }
    const { api, database } = setup({
      connect: async () => {
        const entry = connection()
        const destroy = mock(entry.client.destroy)
        entry.client.destroy = destroy
        entry.client.query = async () => typed
        entry.client.types = reads
        opened.push({ ...entry, destroy })
        return entry.client
      },
    })
    const other = database.forOwner(2)
    const a = value(await api.openSession("db", "a"))
    const b = value(await other.openSession("db", "b"))
    const first = api.query(a, "first", "SELECT ip")
    let second: ReturnType<typeof other.query> | undefined
    try {
      await started.promise
      second = other.query(b, "second", "SELECT ip")
      value(await api.cancel("first"))
      const cancelled = value(await first)
      expect(cancelled.rows).toEqual(typed.rows)
      expect(cancelled.columns[0].dbType).toBeUndefined()
      await database.closeOwner(1, true)
      expect(opened[1].destroy).not.toHaveBeenCalled()
      pending.resolve([{ dbType: "inet", typeFamily: "string" }])
      expect(value(await second).columns[0].dbType).toBe("inet")
      expect(reads).toHaveBeenCalledTimes(1)
      expect(
        (await other.sync()).sessions.filter(
          (session) => session.kind === "schema",
        ),
      ).toHaveLength(1)
      await database.closeOwner(2, true)
      expect(opened[1].destroy).toHaveBeenCalledTimes(1)
    } finally {
      pending.resolve([])
      await Promise.all([first, second])
      await database.closeOwner(2, true)
    }
  })

  test("configuration changes require disconnecting and invalidate the catalog", async () => {
    const { api, entries } = setup()
    value(await api.connect("db"))
    value(await api.inspect("db"))
    expect((await api.sync()).connections[0].schema).toHaveLength(1)
    expect((await api.update("db", { name: "changed" })).ok).toBe(false)
    expect((await api.remove("db")).ok).toBe(false)
    expect(entries.get("db")?.name).toBeUndefined()
    value(await api.disconnect("db"))
    value(await api.update("db", { name: "changed" }))
    expect((await api.sync()).connections[0].schema).toBeNull()
    expect(entries.get("db")?.name).toBe("changed")
    value(await api.remove("db"))
    expect((await api.sync()).connections).toEqual([])
  })

  test("sessions connect lazily, reuse their own connection, and reject another window", async () => {
    const { api, database, clients } = setup()
    const a = value(await api.openSession("db", "a"))
    const b = value(await api.openSession("db", "b"))
    expect(value(await api.openSession("db", "a"))).toBe(a)
    expect(clients).toHaveLength(0)
    const other = database.forOwner(2)
    expect((await other.query(a, "foreign", "DELETE FROM items")).ok).toBe(
      false,
    )
    expect(clients).toHaveLength(0)
    value(await api.query(a, "begin", "BEGIN"))
    value(await api.query(b, "select", "SELECT 1"))
    value(await api.query(a, "rollback", "ROLLBACK"))
    expect(clients.map((entry) => entry.sql)).toEqual([
      ["BEGIN", "ROLLBACK"],
      ["SELECT 1"],
    ])
    expect((await other.sync()).sessions).toEqual([])
    await database.closeOwner(1, true)
    await Promise.all(clients.map((entry) => entry.closed.promise))
    expect((await api.sync()).sessions).toEqual([])
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

  test("SQL errors keep the session, transport failure requires explicit rebuilding without replay", async () => {
    const { api, clients } = setup()
    const id = value(await api.openSession("db", "a"))
    value(await api.query(id, "first", "SELECT 1"))
    clients[0].client.query = async () => {
      throw new Error("syntax error")
    }
    expect((await api.query(id, "bad", "BAD SQL")).ok).toBe(false)
    expect((await api.sync()).sessions[0].status).toBe("ready")
    clients[0].fail()
    expect((await api.query(id, "lost", "UPDATE items SET n = 1")).ok).toBe(
      false,
    )
    expect((await api.sync()).sessions[0].status).toBe("failed")
    const fresh = value(await api.openSession("db", "a"))
    expect(fresh).not.toBe(id)
    expect(clients).toHaveLength(1)
    value(await api.query(fresh, "new", "SELECT 2"))
    expect(clients[1].sql).toEqual(["SELECT 2"])
  })

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

  test.each([true, false])(
    "after stopping SQL, rollback decision %s cannot run queued SQL or replay the cancelled query",
    async (accepted) => {
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
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([
        "stop",
        "force",
      ])
      slow.resolve(result)
      value(await running)
      value(await api.query(id, "usable", "SELECT 1"))
    } finally {
      slow.resolve(result)
      await running
    }
  })

  test.each([false, true])(
    "browse closure decision %s stops only the target tab and preserves its shared connection",
    async (accepted) => {
      const slow = Promise.withResolvers<DriverResult>()
      const started = Promise.withResolvers<void>()
      const entry = connection()
      const calls: string[] = []
      const cancel = mock(async () => slow.reject(new Error("cancelled")))
      entry.client.cancel = cancel
      entry.client.select = async (query) => {
        calls.push(query.from.table)
        if (query.from.table === "slow") {
          started.resolve()
          return { result: await slow.promise, executedSql: "SLOW" }
        }
        return { result, executedSql: "SELECT 1" }
      }
      const confirm = mock<Confirm>(async () => accepted)
      const { api } = setup({ connect: async () => entry.client, confirm })
      const running = api.select("db", "a", "slow", {
        from: { schema: "public", table: "slow" },
      })
      await started.promise
      const queued = api.select("db", "a", "queued", {
        from: { schema: "public", table: "queued" },
      })
      const other = api.select("db", "b", "other", {
        from: { schema: "public", table: "other" },
      })
      try {
        expect(value(await api.closeTab("a"))).toBe(accepted)
        expect(confirm.mock.calls.map((call) => call[3])).toEqual(["stop"])
        if (accepted) {
          expect((await running).ok).toBe(false)
          expect(await queued).toMatchObject({ ok: false, kind: "cancelled" })
          expect(cancel).toHaveBeenCalledTimes(1)
        } else {
          expect(cancel).not.toHaveBeenCalled()
          slow.resolve(result)
          value(await running)
          value(await queued)
        }
        value(await other)
        expect(calls).toEqual(
          accepted ? ["slow", "other"] : ["slow", "queued", "other"],
        )
        expect((await api.sync()).sessions[0].status).toBe("ready")
      } finally {
        slow.resolve(result)
        await Promise.allSettled([running, queued, other])
      }
    },
  )

  test("a stop timeout requires force confirmation while a late cancellation still drains", async () => {
    const confirm = mock<Confirm>(
      async (_owner, _message, _detail, kind) => kind === "stop",
    )
    const { api, clients } = setup({ confirm })
    const id = value(await api.openSession("db", "a"))
    value(await api.query(id, "initial", "SELECT 1"))
    const slow = Promise.withResolvers<DriverResult>()
    const started = Promise.withResolvers<void>()
    const control = Promise.withResolvers<void>()
    const query = clients[0].client.query
    clients[0].client.query = async (sql) => {
      if (sql !== "SLOW") return query(sql)
      started.resolve()
      return slow.promise
    }
    clients[0].client.cancel = () => control.promise
    const running = api.query(id, "slow", "SLOW")
    let next: ReturnType<typeof api.query> | undefined
    try {
      await started.promise
      expect(value(await api.closeTab("a"))).toBe(false)
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([
        "stop",
        "force",
      ])
      next = api.query(id, "next", "SELECT 2")
      slow.resolve(result)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(clients[0].sql).toEqual(["SELECT 1"])
      control.resolve()
      value(await running)
      value(await next)
      expect(clients[0].sql).toEqual(["SELECT 1", "SELECT 2"])
    } finally {
      slow.resolve(result)
      control.resolve()
      await Promise.allSettled([running, next])
    }
  }, 10000)

  test("a rollback timeout preserves its lane when force closure is declined", async () => {
    const confirm = mock<Confirm>(
      async (_owner, _message, _detail, kind) => kind === "rollback",
    )
    const { api, clients } = setup({ confirm })
    const id = value(await api.openSession("db", "a"))
    value(await api.query(id, "begin", "BEGIN"))
    const rollback = Promise.withResolvers<DriverResult>()
    const query = clients[0].client.query
    clients[0].client.query = async (sql) => {
      if (sql === "ROLLBACK") {
        await rollback.promise
        return query(sql)
      }
      return query(sql)
    }
    let next: ReturnType<typeof api.query> | undefined
    try {
      expect(value(await api.closeTab("a"))).toBe(false)
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([
        "rollback",
        "force",
      ])
      next = api.query(id, "next", "SELECT 1")
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(clients[0].sql).toEqual(["BEGIN"])
      rollback.resolve(result)
      value(await next)
      expect(clients[0].sql).toEqual(["BEGIN", "ROLLBACK", "SELECT 1"])
    } finally {
      rollback.resolve(result)
      await next
    }
  }, 10000)

  test("testing a connection closes it without saving a configuration", async () => {
    const { api, clients, entries } = setup()
    await api.test(config)
    await clients[0].closed.promise
    expect(entries.size).toBe(1)
    expect((await api.sync()).sessions).toEqual([])
  })
})
