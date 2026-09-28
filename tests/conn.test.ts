import { describe, expect, test } from "bun:test"
import type { Config } from "../src/contracts/database"
import type { ConnectionSession } from "../src/main/database/ports"
import { Sessions } from "../src/main/database/sessions"
import { ConnError, Tasks } from "../src/main/database/tasks"

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
const result = { columns: [], rows: [], rowCount: 0 }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
function fake() {
  const sql: string[] = []
  let destroyed = false
  let fail: (error: Error) => void = () => {}
  const client: ConnectionSession = {
    query: async (text) => {
      sql.push(text)
      return result
    },
    inspect: async () => [],
    select: async () => ({ result, executedSql: "SELECT 1" }),
    close: async () => {
      destroyed = true
    },
    destroy: () => {
      destroyed = true
    },
    cancel: async () => {},
    onFailure: (fn) => {
      fail = fn
      return () => {
        fail = () => {}
      }
    },
  }
  return {
    client,
    sql,
    fail: () => fail(new Error("lost connection")),
    get destroyed() {
      return destroyed
    },
  }
}
function manager(
  connect: () => Promise<ConnectionSession>,
  confirm = async () => true,
  limit = 32,
) {
  return new Sessions({ configs: () => [config], connect, confirm, limit })
}

describe("task scheduling", () => {
  test("queued cancellation never sends SQL; different lanes run independently", async () => {
    const tasks = new Tasks(),
      first = deferred<number>()
    const calls: string[] = []
    const a = tasks.run(
      { id: "a", sessionId: "s", owner: 1 },
      async (start) => {
        start(async () => {})
        calls.push("a")
        return first.promise
      },
    )
    const b = tasks.run({ id: "b", sessionId: "s", owner: 1 }, async () => {
      calls.push("b")
      return 2
    })
    const rejected = b.catch((error) => error)
    await tasks.cancel("b", 1)
    await tasks.run({ id: "c", sessionId: "t", owner: 1 }, async () => {
      calls.push("c")
    })
    expect(calls).toEqual(["a", "c"])
    first.resolve(1)
    await a
    expect(await rejected).toMatchObject({ kind: "cancelled" })
    await tick()
    expect(calls).toEqual(["a", "c"])
  })
  test("a late cancellation blocks the next query and preserves a successful result", async () => {
    const tasks = new Tasks(),
      query = deferred<number>(),
      control = deferred<void>()
    let next = false
    const a = tasks.run(
      { id: "a", sessionId: "s", owner: 1 },
      async (start) => {
        start(() => control.promise)
        return query.promise
      },
    )
    await tick()
    const cancel = tasks.cancel("a", 1)
    const b = tasks.run({ id: "b", sessionId: "s", owner: 1 }, async () => {
      next = true
    })
    query.resolve(7)
    await tick()
    expect(next).toBe(false)
    control.resolve()
    await cancel
    expect(await a).toBe(7)
    await b
    expect(next).toBe(true)
  })
  test("a completed result survives transport loss while its cancel control drains", async () => {
    const tasks = new Tasks(),
      query = deferred<number>(),
      control = deferred<void>()
    const running = tasks.run(
      { id: "q", sessionId: "s", owner: 1 },
      async (start) => {
        start(() => control.promise)
        return query.promise
      },
    )
    await tick()
    const cancel = tasks.cancel("q", 1)
    query.resolve(42)
    await tick()
    tasks.fail("s", "lost after result")
    control.resolve()
    await cancel
    expect(await running).toBe(42)
  })
  test("ownership, duplicate requests and cancellation failures", async () => {
    const tasks = new Tasks(),
      query = deferred<number>()
    const a = tasks.run(
      { id: "a", sessionId: "s", owner: 1 },
      async (start) => {
        start(async () => {
          throw new Error("denied")
        })
        return query.promise
      },
    )
    await tick()
    await expect(tasks.cancel("a", 2)).rejects.toThrow("无权")
    expect(() =>
      tasks.run({ id: "a", sessionId: "s", owner: 1 }, async () => 0),
    ).toThrow("重复")
    await expect(tasks.cancel("a", 1)).rejects.toThrow("denied")
    expect(tasks.snapshot(1)[0].status).toBe("running")
    query.resolve(1)
    expect(await a).toBe(1)
  })
})

describe("session lifecycle", () => {
  test("lazy creation, per-tab reuse, isolated helpers and session limit", async () => {
    const clients: ReturnType<typeof fake>[] = []
    const sessions = manager(
      async () => {
        const f = fake()
        clients.push(f)
        return f.client
      },
      undefined,
      4,
    )
    const a = sessions.open("db", 1, "a")
    expect(sessions.open("db", 1, "a")).toBe(a)
    expect(clients).toHaveLength(0)
    const b = sessions.open("db", 1, "b")
    await Promise.all([
      sessions.query(a, 1, "a1", "BEGIN"),
      sessions.query(b, 1, "b1", "SELECT 1"),
    ])
    await sessions.query(a, 1, "a2", "ROLLBACK")
    await sessions.inspect("db", 1)
    await sessions.select("db", 1, "view", "v1", {
      from: { schema: "public", table: "x" },
    })
    expect(clients).toHaveLength(4)
    expect(clients[0].sql).toEqual(["BEGIN", "ROLLBACK"])
    expect(clients[1].sql).toEqual(["SELECT 1"])
    expect(() => sessions.open("db", 1, "c")).toThrow("上限")
    await sessions.disconnect("db", 1)
    expect(clients.every((f) => f.destroyed)).toBe(true)
    expect(sessions.snapshot(1).connections[0].generation).toBe(1)
  })
  test("closing during connection creation destroys a late connection and never executes SQL", async () => {
    const pending = deferred<ConnectionSession>(),
      f = fake()
    const sessions = manager(() => pending.promise)
    const id = sessions.open("db", 1, "a")
    const response = sessions.respond(1, () =>
      sessions.query(id, 1, "q", "UPDATE x"),
    )
    await tick()
    await sessions.closeOwner(1, true)
    expect((await response).ok).toBe(false)
    pending.resolve(f.client)
    await tick()
    expect(f.destroyed).toBe(true)
    expect(f.sql).toEqual([])
    expect(sessions.snapshot(1).sessions).toEqual([])
  })
  test("close gates new requests before confirmation, return preserves session", async () => {
    const prompt = deferred<boolean>(),
      f = fake()
    const sessions = manager(
      async () => f.client,
      () => prompt.promise,
    )
    const id = sessions.open("db", 1, "a")
    await sessions.query(id, 1, "q", "BEGIN")
    const closing = sessions.disconnect("db", 1)
    expect(() => sessions.open("db", 1, "b")).toThrow("正在关闭")
    expect(() => sessions.query(id, 1, "q2", "COMMIT")).toThrow("正在关闭")
    prompt.resolve(false)
    expect(await closing).toBe(false)
    expect(f.destroyed).toBe(false)
    await sessions.query(id, 1, "q3", "ROLLBACK")
  })
  test("SQL errors retain session, transport failure invalidates and reconnect does not replay", async () => {
    const first = fake(),
      second = fake()
    let count = 0
    const sessions = manager(
      async () => (++count === 1 ? first : second).client,
    )
    const id = sessions.open("db", 1, "a")
    first.client.query = async () => {
      throw new Error("syntax")
    }
    const error = await sessions.respond(1, () =>
      sessions.query(id, 1, "q", "BAD SQL"),
    )
    expect(error.ok).toBe(false)
    expect(error.snapshot.sessions[0].status).toBe("ready")
    first.fail()
    expect(sessions.snapshot(1).sessions[0].status).toBe("failed")
    await expect(sessions.query(id, 1, "q2", "SELECT 1")).rejects.toThrow(
      "lost",
    )
    const fresh = sessions.open("db", 1, "a")
    expect(fresh).not.toBe(id)
    expect(count).toBe(1)
    await sessions.query(fresh, 1, "q3", "SELECT 2")
    expect(second.sql).toEqual(["SELECT 2"])
    await sessions.closeOwner(1, true)
  })
  test("failed rollback requires a separate force decision and preserves failure", async () => {
    const f = fake(),
      decisions: boolean[] = [true, false, true, true]
    const sessions = manager(
      async () => f.client,
      async () => decisions.shift() ?? false,
    )
    const id = sessions.open("db", 1, "a")
    await sessions.query(id, 1, "q", "BEGIN")
    f.client.query = async () => {
      throw new Error("rollback failed")
    }
    expect(await sessions.closeSession(id, 1)).toBe(false)
    expect(f.destroyed).toBe(false)
    expect(sessions.snapshot(1).sessions[0].error).toBe("rollback failed")
    expect(await sessions.closeSession(id, 1)).toBe(true)
    expect(f.destroyed).toBe(true)
  })
  test("loss during execution reports unknown; other windows cannot use the session", async () => {
    const f = fake(),
      pending = deferred<typeof result>()
    const sessions = manager(async () => f.client)
    const id = sessions.open("db", 1, "a")
    expect(() => sessions.query(id, 2, "bad", "SELECT 1")).toThrow("不属于")
    f.client.query = () => pending.promise
    const response = sessions.respond(1, () =>
      sessions.query(id, 1, "q", "UPDATE x"),
    )
    await tick()
    f.fail()
    expect(await response).toMatchObject({ ok: false, kind: "unknown" })
    pending.reject(new ConnError("lost", "unknown"))
    await tick()
    expect(sessions.snapshot(1).tasks).toEqual([])
  })
})
