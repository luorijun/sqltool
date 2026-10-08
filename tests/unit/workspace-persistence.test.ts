import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { getDefaultStore } from "jotai"
import type { WorkspaceSnapshot } from "../../src/contracts/workspace"
import { workspaceSnapshot } from "../../src/main/ipc/validation"
import client, {
  snapshotAtom,
} from "../../src/renderer/modules/database/client"
import {
  activeQueryTabAtom,
  activeTabIdAtom,
  activeViewTabAtom,
  closeTabAtom,
  openQueryTabAtom,
  openViewTabAtom,
  runActiveQueryTabSqlAtom,
  selectTabAtom,
  setActiveViewTabPageAtom,
  setActiveViewTabPageSizeAtom,
  setViewTabSortAtom,
  tabsAtom,
  updateQueryEditorAtom,
} from "../../src/renderer/modules/workspace"
import {
  reloadWorkspaceTables,
  restoreWorkspace,
  restoreWorkspaceAtom,
  startWorkspaceSaving,
  workspaceSnapshotAtom,
} from "../../src/renderer/modules/workspace/persistence"
import { renderer } from "../support/renderer"

const store = getDefaultStore()
const result = {
  columns: [{ id: "n", name: "n", typeFamily: "number" as const }],
  rows: [[1]],
}
let env: ReturnType<typeof renderer>

async function closeTabs() {
  for (const tab of store.get(tabsAtom)) await store.set(closeTabAtom, tab.id)
}

beforeEach(async () => {
  env = renderer(store.get(snapshotAtom)?.version ?? 0)
  env.bridge.closeTab = async (tabId) => {
    env.snapshot.sessions = env.snapshot.sessions.filter(
      (session) => session.tabId !== tabId,
    )
    return env.ok(true)
  }
  env.bridge.openSession = async (configId, tabId) => {
    const id = crypto.randomUUID()
    env.snapshot.sessions.push({
      id,
      configId,
      tabId,
      kind: "sql",
      status: "ready",
      used: false,
      error: null,
    })
    return env.ok(id)
  }
  env.bridge.query = mock(async () => env.ok(result))
  env.bridge.select = mock(async (_config, _tab, _request, query) =>
    env.ok({
      result: query.select ? { ...result, rows: [[300]] } : result,
      executedSql: "fresh SQL",
    }),
  )
  await client.sync()
})

afterEach(async () => {
  await closeTabs()
  env.restore()
})

describe("workspace persistence", () => {
  test.each(["postgres", "mysql"] as const)(
    "restores drafts and reloads all browse tabs with their original query (%s)",
    async (driver) => {
      env.snapshot.connections[0].config = {
        ...env.snapshot.connections[0].config,
        driver,
      }
      const queryId = store.set(openQueryTabAtom, {
        label: "draft",
        configId: "db",
        initialSql: "SELECT 1",
      })
      await store.set(runActiveQueryTabSqlAtom, {
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
      await store.set(setViewTabSortAtom, {
        tabId: viewId,
        order: ["n"],
        sort: [{ column: "n", direction: "desc" }],
      })
      await store.set(setActiveViewTabPageSizeAtom, {
        tabId: store.get(activeTabIdAtom) ?? "",
        limit: 50,
      })
      await store.set(setActiveViewTabPageAtom, {
        tabId: store.get(activeTabIdAtom) ?? "",
        page: 3,
      })
      const secondViewId = await store.set(openViewTabAtom, {
        configId: "db",
        source: { ...source, table: "other" },
      })
      store.set(selectTabAtom, queryId)
      const saved = workspaceSnapshot.parse(
        JSON.parse(JSON.stringify(store.get(workspaceSnapshotAtom))),
      )
      expect(saved.tabs[0]).toMatchObject({
        label: "draft",
        editor: { text: "DELETE FROM users;", scroll: { top: 30, left: 10 } },
      })
      expect(saved.tabs[0]).not.toHaveProperty("sessionId")
      expect(saved.tabs[0]).not.toHaveProperty("table")
      expect(saved.tabs[0]).not.toHaveProperty("logger")
      expect(saved.tabs[1]).toMatchObject({
        sort: [{ column: "n", direction: "desc" }],
        sortOrder: ["n"],
        offset: 100,
        limit: 50,
      })
      expect(saved.tabs[1]).not.toHaveProperty("data")

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
        logger: { logs: [] },
      })
      expect(store.get(activeQueryTabAtom)?.sessionId).toBeUndefined()
      store.set(selectTabAtom, viewId)
      expect(store.get(activeViewTabAtom)).toMatchObject({
        table: { status: "idle", data: [], sql: "", totalCount: null },
        logger: { logs: [] },
      })
      store.set(selectTabAtom, queryId)
      await reloadWorkspaceTables()
      expect(query).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      expect(select).toHaveBeenCalledTimes(4)
      expect(select).toHaveBeenCalledWith("db", viewId, expect.any(String), {
        from: source,
        orderBy: [{ column: "n", direction: "desc" }],
        offset: 100,
        limit: 50,
      })
      expect(store.get(activeTabIdAtom)).toBe(queryId)
      store.set(selectTabAtom, viewId)
      expect(store.get(activeViewTabAtom)?.table.sql).toBe("fresh SQL")
      const next = store.set(openQueryTabAtom)
      expect([queryId, viewId, secondViewId]).not.toContain(next)
    },
  )

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

  test("restores an empty workspace and advances the tab counter for saved IDs", () => {
    store.set(restoreWorkspaceAtom, { version: 1, activeTabId: null, tabs: [] })
    expect(store.get(activeTabIdAtom)).toBeNull()
    const tabId = store.set(openQueryTabAtom)
    const saved = store.get(workspaceSnapshotAtom)
    return closeTabs().then(() => {
      const highId = String(Number(tabId) + 1000)
      const tab = { ...saved.tabs[0], id: highId }
      store.set(restoreWorkspaceAtom, {
        version: 1,
        activeTabId: "absent",
        tabs: [tab],
      })
      expect(store.get(activeTabIdAtom)).toBe(highId)
      expect(Number(store.set(openQueryTabAtom))).toBeGreaterThan(
        Number(highId),
      )
    })
  })

  test("periodically saves edits and ignores query results and logs", async () => {
    const tabId = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    const save = mock(async (_snapshot: WorkspaceSnapshot) => {})
    env.workspace.save = save
    const onError = mock()
    const stop = startWorkspaceSaving(onError, 10)
    try {
      await Bun.sleep(30)
      expect(save).not.toHaveBeenCalled()
      await store.set(runActiveQueryTabSqlAtom, {
        tabId: store.get(activeTabIdAtom) ?? "",
      })
      await Bun.sleep(30)
      expect(save).not.toHaveBeenCalled()
      store.set(updateQueryEditorAtom, {
        tabId,
        update: (editor) => ({ ...editor, text: "SELECT 2" }),
      })
      await Bun.sleep(30)
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][0].tabs[0]).toMatchObject({
        editor: { text: "SELECT 2" },
      })
      await Bun.sleep(30)
      expect(save).toHaveBeenCalledTimes(1)
      await closeTabs()
      await Bun.sleep(30)
      expect(save.mock.calls.at(-1)?.[0]).toEqual({
        version: 1,
        activeTabId: null,
        tabs: [],
      })
      expect(onError).not.toHaveBeenCalled()
    } finally {
      stop()
    }
    store.set(openQueryTabAtom)
    const count = save.mock.calls.length
    await Bun.sleep(30)
    expect(save).toHaveBeenCalledTimes(count)
  })

  test("does not save before restoration and does not overlap slow writes", async () => {
    const queryId = store.set(openQueryTabAtom, { initialSql: "old draft" })
    const saved = store.get(workspaceSnapshotAtom)
    await closeTabs()
    const load = Promise.withResolvers<WorkspaceSnapshot | null>()
    env.workspace.load = () => load.promise
    const save = mock(async (_snapshot: WorkspaceSnapshot) => {})
    env.workspace.save = save
    const restoring = restoreWorkspace()
    await Bun.sleep(30)
    expect(save).not.toHaveBeenCalled()
    load.resolve(saved)
    await restoring
    const pending = Promise.withResolvers<void>()
    env.workspace.save = mock(() => pending.promise)
    const stop = startWorkspaceSaving(mock(), 10)
    try {
      store.set(updateQueryEditorAtom, {
        tabId: queryId,
        update: (editor) => ({ ...editor, text: "new draft" }),
      })
      await Bun.sleep(30)
      expect(env.workspace.save).toHaveBeenCalledTimes(1)
      store.set(updateQueryEditorAtom, {
        tabId: queryId,
        update: (editor) => ({ ...editor, text: "latest draft" }),
      })
      await Bun.sleep(30)
      expect(env.workspace.save).toHaveBeenCalledTimes(1)
      pending.resolve()
      await Bun.sleep(30)
      expect(env.workspace.save).toHaveBeenCalledTimes(2)
      expect(store.get(activeQueryTabAtom)?.editor.text).toBe("latest draft")
    } finally {
      pending.resolve()
      stop()
    }
  })

  test("validates the saved format and rejects duplicate tab IDs", () => {
    store.set(openQueryTabAtom)
    const saved = store.get(workspaceSnapshotAtom)
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
})
