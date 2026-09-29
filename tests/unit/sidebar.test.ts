import { describe, expect, test } from "bun:test"
import type { Connection } from "../../src/contracts/database"
import {
  buildTree,
  canRefresh,
  nodeKey,
  selectedNode,
  visibleNodes,
} from "../../src/renderer/pages/workbench/sidebar/tree"

const connection: Connection = {
  config: {
    id: "db",
    name: "Local",
    driver: "postgres",
    host: "localhost",
    port: "5432",
    username: "u",
    password: "p",
    database: "db",
    createdAt: 0,
    updatedAt: 0,
  },
  connected: true,
  sessionCount: 1,
  failedCount: 0,
  generation: 0,
  error: null,
  schema: [
    {
      name: "public",
      tables: [{ name: "items", columns: [{ name: "id", type: "int" }] }],
      views: [{ name: "v" }],
      functions: [],
    },
  ],
}

describe("sidebar tree state", () => {
  test("updated tree data keeps object identity and a missing object falls back to its parent", () => {
    const key = nodeKey("db", "public", "tables", "items")
    const expanded = new Set([
      nodeKey("db"),
      nodeKey("db", "public"),
      nodeKey("db", "public", "tables"),
      key,
    ])
    const updated = structuredClone(connection)
    if (!updated.schema) throw new Error("Missing fixture schema")
    updated.schema[0].tables[0].columns.push({ name: "fresh", type: "text" })
    const rows = visibleNodes(buildTree([updated]), expanded)
    expect(selectedNode(rows, key)?.label).toBe("items")
    expect(rows.some((node) => node.label === "fresh")).toBe(true)
    updated.schema[0].tables = []
    const removed = visibleNodes(buildTree([updated]), expanded)
    expect(selectedNode(removed, key)?.kind).toBe("section")
    expect(selectedNode(buildTree([]), key)).toBeUndefined()
  })

  test("visibility and selection follow parent expansion", () => {
    const nodes = buildTree([connection])
    const key = nodeKey("db", "public", "tables", "items")
    const expanded = new Set([
      nodeKey("db", "public"),
      nodeKey("db", "public", "tables"),
      key,
    ])
    expect(visibleNodes(nodes, expanded)).toHaveLength(1)
    expect(selectedNode(visibleNodes(nodes, expanded), key)?.kind).toBe(
      "connection",
    )
    expanded.add(nodeKey("db"))
    expect(
      visibleNodes(nodes, expanded).some((node) => node.kind === "column"),
    ).toBe(true)
  })

  test("refresh is scoped to connected database and table nodes, with unambiguous object identities", () => {
    const nodes = buildTree([connection])
    expect(nodes.filter(canRefresh).map((node) => node.kind)).toEqual([
      "connection",
      "table",
    ])
    expect(
      buildTree([{ ...connection, connected: false }]).some(canRefresh),
    ).toBe(false)
    expect(nodeKey("db", "a:b", "tables", "c")).not.toBe(
      nodeKey("db", "a", "tables", "b:c"),
    )
  })
})
