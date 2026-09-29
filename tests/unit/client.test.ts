import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { getDefaultStore } from "jotai"
import client, {
  connectConnectionAtom,
  connectionActionAtom,
  disconnectConnectionAtom,
  snapshotAtom,
} from "../../src/renderer/modules/database/client"
import { renderer } from "../support/renderer"

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
    env.bridge.connect = async () => {
      calls.push("connect")
      await ready.promise
      return env.ok(undefined)
    }
    env.bridge.inspect = async () => {
      calls.push("inspect")
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
      expect(calls).toEqual(["connect", "inspect"])
      expect(store.get(connectionActionAtom).db).toBeUndefined()
    } finally {
      ready.resolve()
      await Promise.allSettled([first, second])
    }
  })

  test("failed connection releases the action and never requests structure", async () => {
    env.bridge.connect = async () => {
      throw new Error("connect failed")
    }
    let inspected = false
    env.bridge.inspect = async () => {
      inspected = true
      return env.ok(undefined)
    }
    await expect(store.set(connectConnectionAtom, "db")).rejects.toThrow(
      "connect failed",
    )
    expect(inspected).toBe(false)
    expect(store.get(connectionActionAtom).db).toBeUndefined()
    env.bridge.connect = async () => env.ok(undefined)
    await store.set(connectConnectionAtom, "db")
    expect(inspected).toBe(true)
  })
})
