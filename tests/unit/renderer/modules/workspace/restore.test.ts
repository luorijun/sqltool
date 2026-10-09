import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import {
  activeQueryTabAtom,
  activeTabIdAtom,
  activeViewTabAtom,
  openQueryTabAtom,
  openViewTabAtom,
  runQueryAtom,
  selectTabAtom,
  setViewPageAtom,
  setViewPageSizeAtom,
  setViewSortAtom,
  tabsAtom,
  updateQueryEditorAtom,
} from "@/renderer/modules/workspace"
import {
  reloadWorkspaceTables,
  restoreWorkspace,
  restoreWorkspaceAtom,
  workspaceSnapshotAtom,
} from "@/renderer/modules/workspace/persistence"

const store = getDefaultStore()
const result = {
  columns: [{ id: "n", name: "n", typeFamily: "number" as const }],
  rows: [[1]],
}
let env: Awaited<ReturnType<typeof setupWorkspace>>
const closeTabs = async () => {
  await env.closeTabs()
}
beforeEach(async () => {
  env = await setupWorkspace()
  env.bridge.query = mock(async () => env.ok(result))
  env.bridge.select = mock(async (_config, _tab, _request, query) =>
    env.ok({
      result: query.select ? { ...result, rows: [[300]] } : result,
      executedSql: "fresh SQL",
    }),
  )
})
afterEach(async () => {
  await env.dispose()
})

test("restores drafts and reloads all browse tabs with their original query", async () => {
  const queryId = store.set(openQueryTabAtom, {
    label: "draft",
    configId: "db",
    initialSql: "SELECT 1",
  })
  await store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  store.set(updateQueryEditorAtom, {
    tabId: queryId,
    update: (editor) => ({
      ...editor,
      text: "DELETE FROM users;",
      cursor: { line: 1, col: 8 },
      selections: [{ anchor: 7, head: 7 }],
      scroll: { top: 30, left: 10 },
    }),
  })
  const source = { schema: "public", table: "items" }
  const viewId = await store.set(openViewTabAtom, {
    configId: "db",
    source,
  })
  await store.set(setViewSortAtom, {
    tabId: viewId,
    order: ["n"],
    sort: [{ column: "n", direction: "desc" }],
  })
  await store.set(setViewPageSizeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    limit: 50,
  })
  await store.set(setViewPageAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    page: 3,
  })
  const secondViewId = await store.set(openViewTabAtom, {
    configId: "db",
    source: { ...source, table: "other" },
  })
  store.set(selectTabAtom, queryId)
  const saved = structuredClone(store.get(workspaceSnapshotAtom))

  await closeTabs()
  const query = mock(env.bridge.query)
  const open = mock(env.bridge.openSession)
  const select = mock(env.bridge.select)
  env.bridge.query = query
  env.bridge.openSession = open
  env.bridge.select = select
  env.workspace.load = async () => saved
  await restoreWorkspace()
  expect(store.get(activeTabIdAtom)).toBe(queryId)
  expect(store.get(tabsAtom).map((tab) => tab.id)).toEqual([
    queryId,
    viewId,
    secondViewId,
  ])
  expect(store.get(activeQueryTabAtom)).toMatchObject({
    editor: {
      text: "DELETE FROM users;",
      selections: [{ anchor: 7, head: 7 }],
    },
    table: { status: "idle", data: [], columns: [] },
    log: { logs: [] },
  })
  expect(store.get(activeQueryTabAtom)?.sessionId).toBeUndefined()
  store.set(selectTabAtom, viewId)
  expect(store.get(activeViewTabAtom)).toMatchObject({
    table: { status: "idle", data: [], sql: "", totalCount: null },
    log: { logs: [] },
  })
  store.set(selectTabAtom, queryId)
  await reloadWorkspaceTables()
  expect(query).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(select).toHaveBeenCalledWith("db", viewId, expect.any(String), {
    from: source,
    orderBy: [{ column: "n", direction: "desc" }],
    offset: 100,
    limit: 50,
  })
  expect(store.get(activeTabIdAtom)).toBe(queryId)
  store.set(selectTabAtom, viewId)
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    status: "success",
    sql: "fresh SQL",
    offset: 100,
    limit: 50,
    sort: [{ column: "n", direction: "desc" }],
  })
  expect(store.get(activeViewTabAtom)?.table.data).toHaveLength(1)
  store.set(selectTabAtom, secondViewId)
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    status: "success",
    sql: "fresh SQL",
  })
  expect(store.get(activeViewTabAtom)?.table.data).toHaveLength(1)
  const next = store.set(openQueryTabAtom)
  expect([queryId, viewId, secondViewId]).not.toContain(next)
})

test("preserves pages and drafts when browse loading fails", async () => {
  store.set(openQueryTabAtom, { initialSql: "unfinished draft" })
  await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "missing" },
  })
  const saved = store.get(workspaceSnapshotAtom)
  await closeTabs()
  env.workspace.load = async () => saved
  env.bridge.select = async () => ({
    ok: false,
    error: "table missing",
    kind: "error",
    snapshot: env.capture(),
  })
  await restoreWorkspace()
  await reloadWorkspaceTables()
  expect(store.get(tabsAtom)).toHaveLength(2)
  expect(store.get(activeViewTabAtom)?.table).toMatchObject({
    status: "error",
    error: "table missing",
    data: [],
  })
  store.set(selectTabAtom, saved.tabs[0].id)
  expect(store.get(activeQueryTabAtom)?.editor.text).toBe("unfinished draft")
})

test("restores an empty workspace and creates tab IDs without colliding with saved tabs", async () => {
  store.set(restoreWorkspaceAtom, { version: 1, activeTabId: null, tabs: [] })
  expect(store.get(activeTabIdAtom)).toBeNull()
  store.set(openQueryTabAtom)
  const saved = store.get(workspaceSnapshotAtom)
  await closeTabs()
  const id = "1000000"
  store.set(restoreWorkspaceAtom, {
    version: 1,
    activeTabId: "absent",
    tabs: [{ ...saved.tabs[0], id }],
  })
  expect(store.get(activeTabIdAtom)).toBe(id)
  const next = store.set(openQueryTabAtom)
  expect(next).not.toBe(id)
  expect(store.get(tabsAtom).map((tab) => tab.id)).toEqual([id, next])
})
