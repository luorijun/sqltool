import { describe, expect, test } from "bun:test"
import {
  profile,
  query,
  tableSource,
  workspaceSnapshot,
} from "@/main/ipc/validation"

describe("database request validation", () => {
  test("accepts exact object names but rejects incomplete table targets", () => {
    const source = { schema: "a.b", table: "quotes' and spaces" }
    expect(tableSource.parse(source)).toEqual(source)
    expect(tableSource.safeParse({ schema: "public" }).success).toBe(false)
    expect(tableSource.safeParse({ ...source, owner: 2 }).success).toBe(false)
  })

  test("rejects unsupported drivers and incomplete SSH settings, and strips caller identity", () => {
    const input = {
      driver: "postgres",
      host: "localhost",
      port: "5432",
      username: "u",
      password: "p",
      database: "db",
    }
    expect(profile.safeParse({ ...input, driver: "unsupported" }).success).toBe(
      false,
    )
    expect(profile.safeParse({ ...input, ssh: { host: "jump" } }).success).toBe(
      false,
    )
    expect(profile.parse({ ...input, owner: 2 })).not.toHaveProperty("owner")
  })

  test("rejects raw conditions and invalid paging", () => {
    const from = { schema: "public", table: "items" }
    expect(query.safeParse({ from, where: { operator: "raw" } }).success).toBe(
      false,
    )
    expect(query.safeParse({ from, limit: -1 }).success).toBe(false)
    expect(
      query.safeParse({
        from,
        where: {
          operator: "and",
          conditions: [{ column: "id", operator: "eq", value: 1 }],
        },
      }).success,
    ).toBe(true)
  })
})

test("validates the saved format and rejects duplicate tab IDs", () => {
  const saved = {
    version: 1,
    activeTabId: "draft",
    tabs: [
      {
        id: "draft",
        label: "draft",
        kind: "query",
        configId: "db",
        editor: {
          text: "SELECT 1",
          cursor: { line: 1, col: 1 },
          selections: [{ anchor: 0, head: 0 }],
          mainSelectionIndex: 0,
          scroll: { top: 0, left: 0 },
          search: {
            query: "",
            replace: "",
            caseSensitive: false,
            wholeWord: false,
            regexp: false,
            open: false,
          },
        },
      },
    ],
  }
  expect(workspaceSnapshot.safeParse(saved).success).toBe(true)
  expect(workspaceSnapshot.safeParse({ ...saved, version: 2 }).success).toBe(
    false,
  )
  expect(
    workspaceSnapshot.safeParse({
      ...saved,
      tabs: [saved.tabs[0], saved.tabs[0]],
    }).success,
  ).toBe(false)
})
