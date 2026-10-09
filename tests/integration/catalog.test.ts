import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { profile, setup, value } from "@tests/integration/helpers"

describe.each(["postgres", "mysql"] as const)("%s catalog", (driver) => {
  const schema = driver === "postgres" ? "public" : "sqltool_test"
  test("targeted catalog refresh updates changed and dropped tables", async () => {
    const env = await setup(profile(driver))
    const { api, admin } = env
    const table = `catalog_${randomUUID().replaceAll("-", "")}`
    const source = { schema, table }
    const tables = async () =>
      (await api.sync()).connections[0].schema?.find(
        (entry) => entry.name === schema,
      )?.tables
    try {
      await admin.query(`CREATE TABLE ${table} (id INT PRIMARY KEY)`)
      value(await api.inspect("db"))
      await admin.query(`ALTER TABLE ${table} ADD COLUMN fresh TEXT`)
      value(await api.inspect("db", source, true))
      expect(
        (await tables())
          ?.find((entry) => entry.name === table)
          ?.columns.map((column) => column.name),
      ).toEqual(["id", "fresh"])
      await admin.query(`DROP TABLE ${table}`)
      value(await api.inspect("db", source, true))
      expect((await tables())?.some((entry) => entry.name === table)).toBe(
        false,
      )
    } finally {
      await env.close([table])
    }
  })
})
