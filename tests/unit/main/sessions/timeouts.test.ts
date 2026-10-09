import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { clock, drain } from "@tests/support/async"
import { result, setup, value } from "@tests/support/backend"
import type { DriverResult } from "@/main/drivers"
import type { Confirm } from "@/main/sessions"

let time: ReturnType<typeof clock>
beforeEach(() => {
  time = clock()
})
afterEach(() => time.restore())

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
    const closing = api.closeTab("a")
    await time.advance(60_000)
    expect(value(await closing)).toBe(false)
    expect(confirm.mock.calls.map((call) => call[3])).toEqual(["stop", "force"])
    next = api.query(id, "next", "SELECT 2")
    slow.resolve(result)
    await drain()
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
})

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
    const closing = api.closeTab("a")
    await time.advance(60_000)
    expect(value(await closing)).toBe(false)
    expect(confirm.mock.calls.map((call) => call[3])).toEqual([
      "rollback",
      "force",
    ])
    next = api.query(id, "next", "SELECT 1")
    await drain()
    expect(clients[0].sql).toEqual(["BEGIN"])
    rollback.resolve(result)
    value(await next)
    expect(clients[0].sql).toEqual(["BEGIN", "ROLLBACK", "SELECT 1"])
  } finally {
    rollback.resolve(result)
    await next
  }
})
