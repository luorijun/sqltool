import { expect, test } from "bun:test"
import type { QueryResult, SelectQuery } from "@/core/database"
import type { WorkspaceSnapshot } from "@/core/workspace"
import { type ConnResponse, createBridge } from "@/preload/bridge"

test("the pure bridge preserves query content, optional arguments and structured requests", async () => {
  const calls: { channel: string; args: unknown[] }[] = []
  const response: ConnResponse<QueryResult> = {
    ok: true,
    value: { columns: [], rows: [] },
    snapshot: { version: 1, connections: [], sessions: [], tasks: [] },
  }
  const bridge = createBridge(
    async <T>(channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return response as T
    },
  )
  expect(
    await bridge.conn.query("session", "request", "SELECT 'a; b'\n"),
  ).toEqual(response)
  await bridge.conn.inspect("config")
  const query: SelectQuery = {
    from: { schema: "public", table: "items" },
    limit: 10,
    offset: 20,
  }
  await bridge.conn.select("config", "tab", "browse", query)
  expect(calls).toEqual([
    { channel: "conn:query", args: ["session", "request", "SELECT 'a; b'\n"] },
    { channel: "conn:inspect", args: ["config", undefined, false] },
    { channel: "conn:select", args: ["config", "tab", "browse", query] },
  ])
  expect("invoke" in bridge).toBe(false)
})

test("workspace and system calls preserve saved data and propagate transport failures", async () => {
  const snapshot: WorkspaceSnapshot = {
    version: 1,
    activeTabId: null,
    tabs: [],
  }
  const calls: unknown[][] = []
  const bridge = createBridge(
    async <T>(channel: string, ...args: unknown[]) => {
      calls.push([channel, ...args])
      if (channel === "workspace:load") return snapshot as T
      if (channel === "system:save-text-file") return "/tmp/result.csv" as T
      return undefined as T
    },
  )
  expect(await bridge.workspace.load()).toEqual(snapshot)
  await bridge.workspace.save(snapshot)
  const file = {
    content: "id\n1",
    defaultPath: "result.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  }
  expect(await bridge.system.saveTextFile(file)).toBe("/tmp/result.csv")
  await bridge.system.writeClipboardText("id\n1")
  expect(calls).toEqual([
    ["workspace:load"],
    ["workspace:save", snapshot],
    ["system:save-text-file", file],
    ["system:write-clipboard-text", "id\n1"],
  ])
  const error = new Error("transport failed")
  const failed = createBridge(async () => {
    throw error
  })
  await expect(failed.conn.sync()).rejects.toBe(error)
})
