import { afterEach, beforeEach, expect, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import {
  openQueryTabAtom,
  openViewTabAtom,
  runQueryAtom,
  selectTabAtom,
  setViewRangeAtom,
  setViewSortAtom,
  updateQueryEditorAtom,
} from "@/renderer/modules/workspace"
import { workspaceSnapshotAtom } from "@/renderer/modules/workspace/persistence"

const store = getDefaultStore()
let env: Awaited<ReturnType<typeof setupWorkspace>>
beforeEach(async () => {
  env = await setupWorkspace()
})
afterEach(async () => {
  await env.dispose()
})
test("snapshot stores editor and browse configuration without sessions, results or logs", async () => {
  const result = {
    columns: [{ id: "n", name: "n", typeFamily: "number" as const }],
    rows: [[1]],
  }
  env.bridge.query = async () => env.ok(result)
  env.bridge.select = async () => env.ok({ result, executedSql: "SELECT n" })
  const id = store.set(openQueryTabAtom, {
    label: "draft",
    configId: "db",
    initialSql: "SELECT 1",
  })
  await store.set(runQueryAtom, { tabId: id })
  store.set(updateQueryEditorAtom, {
    tabId: id,
    update: (editor) => ({
      ...editor,
      text: "unfinished draft",
      selections: [{ anchor: 2, head: 4 }],
      scroll: { top: 30, left: 10 },
    }),
  })
  const view = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  await store.set(setViewSortAtom, {
    tabId: view,
    order: ["n"],
    sort: [{ column: "n", direction: "desc" }],
  })
  await store.set(setViewRangeAtom, { tabId: view, offset: 100, limit: 50 })
  store.set(selectTabAtom, id)
  const saved = store.get(workspaceSnapshotAtom)
  expect(saved.activeTabId).toBe(id)
  expect(saved.tabs[0]).toMatchObject({
    id,
    kind: "query",
    configId: "db",
    label: "draft",
    editor: {
      text: "unfinished draft",
      selections: [{ anchor: 2, head: 4 }],
      scroll: { top: 30, left: 10 },
    },
  })
  expect(saved.tabs[1]).toMatchObject({
    id: view,
    kind: "view",
    configId: "db",
    source: { schema: "public", table: "items" },
    sort: [{ column: "n", direction: "desc" }],
    sortOrder: ["n"],
    offset: 100,
    limit: 50,
  })
  for (const key of ["sessions", "tasks", "results", "logs"])
    expect(saved).not.toHaveProperty(key)
  for (const tab of saved.tabs) {
    for (const key of [
      "sessionId",
      "execution",
      "table",
      "log",
      "code",
      "closing",
      "cancelling",
      "requestId",
      "countRequestId",
      "results",
      "data",
    ])
      expect(tab).not.toHaveProperty(key)
  }
})
