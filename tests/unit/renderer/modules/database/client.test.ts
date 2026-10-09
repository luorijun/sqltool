import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { renderer } from "@tests/support/renderer"
import { getDefaultStore } from "jotai"
import client, {
  connectConnectionAtom,
  connectionActionAtom,
  disconnectConnectionAtom,
  refreshConnectionAtom,
  snapshotAtom,
} from "@/renderer/modules/database/client"

const store = getDefaultStore()
let env: ReturnType<typeof renderer>
beforeEach(async () => {
  env = renderer(store.get(snapshotAtom)?.version ?? 0)
  await client.sync()
})
afterEach(() => env.restore())

describe("database client", () => {
  test("a late snapshot cannot overwrite a newer response", async () => {
    const old = env.capture()
    env.snapshot.connections = []
    await client.sync()
    env.bridge.sync = async () => old
    await client.sync()
    expect(store.get(snapshotAtom)?.connections).toEqual([])
  })

  test("an error response updates the snapshot before reporting the failure", async () => {
    env.bridge.query = async () => {
      env.snapshot.sessions = [
        {
          id: "lost",
          configId: "db",
          tabId: "tab",
          kind: "sql",
          status: "failed",
          used: true,
          error: "lost",
        },
      ]
      return {
        ok: false,
        kind: "unknown",
        error: "result unknown",
        snapshot: env.capture(),
      }
    }
    await expect(
      client.query("lost", "request", "UPDATE items SET n = 1"),
    ).rejects.toMatchObject({ kind: "unknown" })
    expect(store.get(snapshotAtom)?.sessions[0].status).toBe("failed")
  })

  test("connecting coalesces duplicate requests and rejects conflicting actions", async () => {
    const ready = Promise.withResolvers<void>()
    const calls: string[] = []
    env.bridge.inspect = async () => {
      calls.push("inspect")
      await ready.promise
      return env.ok(undefined)
    }
    const first = store.set(connectConnectionAtom, "db")
    const second = store.set(connectConnectionAtom, "db")
    try {
      expect(store.get(connectionActionAtom).db).toBe("connect")
      await expect(store.set(disconnectConnectionAtom, "db")).rejects.toThrow(
        "正在处理中",
      )
      ready.resolve()
      await Promise.all([first, second])
      expect(calls).toEqual(["inspect"])
      expect(store.get(connectionActionAtom).db).toBeUndefined()
    } finally {
      ready.resolve()
      await Promise.allSettled([first, second])
    }
  })

  test("failed structure acquisition releases the action and can be retried", async () => {
    env.bridge.inspect = async () => {
      throw new Error("connect failed")
    }
    await expect(store.set(connectConnectionAtom, "db")).rejects.toThrow(
      "connect failed",
    )
    expect(store.get(connectionActionAtom).db).toBeUndefined()
    env.bridge.inspect = async () => env.ok(undefined)
    await store.set(connectConnectionAtom, "db")
    expect(store.get(connectionActionAtom).db).toBeUndefined()
  })
  test.each([
    ["open", false],
    ["closed", true],
  ] as const)(
    "disconnect returns its completion decision (%s)",
    async (_case, closed) => {
      env.bridge.disconnect = async () => {
        env.snapshot.connections[0].connected = !closed
        return env.ok(closed)
      }
      expect(await client.disconnect("db")).toBe(closed)
      expect(store.get(snapshotAtom)?.connections[0].connected).toBe(!closed)
      expect(await store.set(disconnectConnectionAtom, "db")).toBe(closed)
    },
  )

  test("background structure reads can proceed during a user refresh", async () => {
    const ready = Promise.withResolvers<void>()
    const inspect = mock<typeof env.bridge.inspect>(async () => {
      await ready.promise
      return env.ok(undefined)
    })
    env.bridge.inspect = inspect
    const source = { schema: "public", table: "items" }
    const refresh = store.set(refreshConnectionAtom, { id: "db", source })
    const background = client.loadSchema("db")
    try {
      await Promise.resolve()
      expect(inspect).toHaveBeenCalledTimes(2)
      expect(inspect).toHaveBeenCalledWith("db", source, true)
      expect(inspect).toHaveBeenCalledWith("db", undefined, false)
      expect(store.get(connectionActionAtom).db).toBe("refresh")
      await expect(store.set(connectConnectionAtom, "db")).rejects.toThrow(
        "正在处理中",
      )
    } finally {
      ready.resolve()
      await Promise.all([refresh, background])
    }
  })
})
