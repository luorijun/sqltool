import { describe, expect, test } from "bun:test"
import { Tasks } from "../../src/main/database/tasks"

describe("task scheduling", () => {
  test("cancelling a queued task never executes it or blocks another session", async () => {
    const tasks = new Tasks()
    const pending = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = tasks.run(
      { id: "first", sessionId: "a", owner: 1 },
      async () => {
        calls.push("first")
        await pending.promise
      },
    )
    const queued = tasks.run(
      { id: "queued", sessionId: "a", owner: 1 },
      async () => {
        calls.push("queued")
      },
    )
    const cancelled = queued.catch((error) => error)
    try {
      await tasks.cancel("queued", 1)
      await tasks.run({ id: "other", sessionId: "b", owner: 1 }, async () => {
        calls.push("other")
      })
      expect(await cancelled).toMatchObject({ kind: "cancelled" })
      expect(calls).toEqual(["first", "other"])
      pending.resolve()
      await first
      await tasks.stop("a")
      expect(calls).toEqual(["first", "other"])
    } finally {
      pending.resolve()
      await Promise.allSettled([first, queued])
      await tasks.stop("a")
    }
  })

  test("a late cancel control drains before the next query and preserves the completed result", async () => {
    const tasks = new Tasks()
    const started = Promise.withResolvers<void>()
    const query = Promise.withResolvers<number>()
    const control = Promise.withResolvers<void>()
    const cancelling = Promise.withResolvers<void>()
    const first = tasks.run(
      { id: "first", sessionId: "a", owner: 1 },
      async (start) => {
        start(() => {
          cancelling.resolve()
          return control.promise
        })
        started.resolve()
        return query.promise
      },
    )
    let next = false
    let cancel: Promise<void> | undefined
    let second: Promise<void> | undefined
    try {
      await started.promise
      cancel = tasks.cancel("first", 1)
      await cancelling.promise
      second = tasks.run(
        { id: "second", sessionId: "a", owner: 1 },
        async () => {
          next = true
        },
      )
      query.resolve(42)
      // Let the completed query drain while the cancellation control stays blocked.
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(next).toBe(false)
      control.resolve()
      await cancel
      expect(await first).toBe(42)
      await second
      expect(next).toBe(true)
    } finally {
      query.resolve(42)
      control.resolve()
      await Promise.allSettled([first, cancel, second])
    }
  })

  test("ownership and cancellation failure cannot discard a running result", async () => {
    const tasks = new Tasks()
    const started = Promise.withResolvers<void>()
    const query = Promise.withResolvers<number>()
    const running = tasks.run(
      { id: "request", sessionId: "a", owner: 1 },
      async (start) => {
        start(async () => {
          throw new Error("cancel denied")
        })
        started.resolve()
        return query.promise
      },
    )
    try {
      await started.promise
      await expect(tasks.cancel("request", 2)).rejects.toThrow("无权")
      expect(() =>
        tasks.run({ id: "request", sessionId: "a", owner: 1 }, async () => 0),
      ).toThrow("重复")
      await expect(tasks.cancel("request", 1)).rejects.toThrow("cancel denied")
      expect(tasks.snapshot(1)[0].status).toBe("running")
      query.resolve(7)
      expect(await running).toBe(7)
    } finally {
      query.resolve(7)
      await running
    }
  })
})
