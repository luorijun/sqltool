import { expect, test } from "bun:test"
import { config, setup, value } from "@tests/support/backend"

test("configuration changes require disconnecting and invalidate the catalog", async () => {
  const { api, entries } = setup()
  value(await api.inspect("db"))
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

test("testing a connection closes it without saving a configuration", async () => {
  const { api, clients, entries } = setup()
  await api.test(config)
  await clients[0].closed.promise
  expect(entries.size).toBe(1)
  expect((await api.sync()).sessions).toEqual([])
})
