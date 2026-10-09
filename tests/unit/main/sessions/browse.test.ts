import { expect, mock, test } from "bun:test"
import {
  config,
  connection,
  result,
  setup,
  value,
} from "@tests/support/backend"
import type { ConnectionSession, DriverResult } from "@/main/drivers"
import type { Confirm } from "@/main/sessions"

test.each(["postgres", "mysql"] as const)(
  "browse compilation passes SQL and bound parameters through the query port (%s)",
  async (driver) => {
    const entry = connection()
    const query = mock<ConnectionSession["query"]>(async () => result)
    entry.client.query = query
    const { api, entries } = setup({ connect: async () => entry.client })
    entries.set("db", { ...config, driver })
    const input = "a' OR 1=1 --"
    const selected = value(
      await api.select("db", "view", "request", {
        from: { schema: "public", table: "items" },
        where: { column: "name", operator: "eq", value: input },
        limit: 50,
        offset: 100,
      }),
    )
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(selected.executedSql).toBe(sql)
    expect(sql).not.toContain(input)
    expect(params).toEqual([input, 50, 100])
    expect(sql).toContain(
      driver === "postgres" ? '"name" = $1' : "\x60name\x60 = ?",
    )
    expect(selected.result).toEqual(result)
  },
)

test("browse sessions are reused within a window and survive another window closing", async () => {
  const entries: ReturnType<typeof connection>[] = []
  const { api, database } = setup({
    connect: async () => {
      const entry = connection()
      entries.push(entry)
      return entry.client
    },
  })
  const other = database.forOwner(2)
  const query = { from: { schema: "public", table: "items" } }
  try {
    value(await api.select("db", "a", "first", query))
    value(await api.select("db", "b", "same-window", query))
    expect(entries).toHaveLength(1)
    value(await other.select("db", "a", "other-window", query))
    expect(entries).toHaveLength(2)
    const first = (await api.sync()).sessions[0]
    const second = (await other.sync()).sessions[0]
    expect(first.kind).toBe("browse")
    expect(second.kind).toBe("browse")
    expect(first.id).not.toBe(second.id)
    const destroy = mock(entries[1].client.destroy)
    entries[1].client.destroy = destroy

    expect(await database.closeOwner(1, true)).toBe(true)
    expect(destroy).not.toHaveBeenCalled()
    expect((await other.sync()).sessions[0]).toMatchObject({
      id: second.id,
      status: "ready",
    })
    value(await other.select("db", "b", "after-close", query))
    expect(entries).toHaveLength(2)
    expect(destroy).not.toHaveBeenCalled()
  } finally {
    await database.closeOwner(2, true)
  }
})

test.each([
  ["declined", false],
  ["accepted", true],
] as const)(
  "browse closure decision %s stops only the target tab and preserves its shared connection",
  async (_case, accepted) => {
    const slow = Promise.withResolvers<DriverResult>()
    const started = Promise.withResolvers<void>()
    const entry = connection()
    const calls: string[] = []
    const cancel = mock(async () => slow.reject(new Error("cancelled")))
    entry.client.cancel = cancel
    entry.client.query = async (sql) => {
      const table = sql.match(/FROM "public"[.]"([a-z]+)"/)?.[1] ?? ""
      calls.push(table)
      if (table === "slow") {
        started.resolve()
        return slow.promise
      }
      return result
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
