import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import type { QueryResult } from "@/core/database"
import {
  activeQueryTabAtom,
  activeViewTabAtom,
  changeCellAtom,
  closeTabAtom,
  discardEditsAtom,
  editedRows,
  openQueryTabAtom,
  openViewTabAtom,
  rebuildSessionAtom,
  runQueryAtom,
  saveEditsAtom,
  setViewPageAtom,
  undoEditAtom,
} from "@/renderer/modules/workspace"
import {
  changeCell,
  createEdits,
  guardEditsAtom,
} from "@/renderer/modules/workspace/edit"

const store = getDefaultStore()
let env: Awaited<ReturnType<typeof setupWorkspace>>
const result: QueryResult = {
  columns: [
    { id: "id", name: "id", typeFamily: "number" },
    { id: "name", name: "name", typeFamily: "string" },
    { id: "computed", name: "computed", typeFamily: "number" },
  ],
  rows: [[1, "before", 2]],
  edit: {
    id: "result",
    source: { schema: "public", table: "items" },
    keys: ["id"],
    writable: ["id", "name"],
  },
}
beforeEach(async () => {
  env = await setupWorkspace()
  env.bridge.query = async () => env.ok(result)
})
afterEach(async () => {
  env.system.confirmChanges = async () => "discard"
  await env.dispose()
})
async function queryTab() {
  const id = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT * FROM items",
  })
  await store.set(runQueryAtom, { tabId: id })
  return id
}
test("cell drafts keep the base result intact, undo/redo survives tabs, and original values remove changes", async () => {
  const id = await queryTab()
  store.set(changeCellAtom, { tabId: id, row: 0, column: "name", value: "" })
  const table = store.get(activeQueryTabAtom)?.table
  if (!table?.edits) throw new Error("Missing table edits")
  expect(table.data[0].name).toBe("before")
  expect(editedRows(table.data, table.edits.changes)[0].name).toBe("")
  store.set(undoEditAtom, { tabId: id })
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes).toEqual([])
  store.set(undoEditAtom, { tabId: id, redo: true })
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes[0].value).toBe("")
  store.set(changeCellAtom, {
    tabId: id,
    row: 0,
    column: "name",
    value: "before",
  })
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes).toEqual([])
  const data = [{ b: new Uint8Array([1]).buffer }]
  expect(
    changeCell(createEdits(), data, {
      row: 0,
      column: "b",
      value: new Uint8Array(),
    }).changes,
  ).toHaveLength(1)
})
test("saving applies the database readback without rerunning SQL and clears undo only on success", async () => {
  const id = await queryTab()
  const query = mock(env.bridge.query)
  env.bridge.query = query
  const save = mock(async () =>
    env.ok({
      rows: [{ row: 0, values: [1, "normalized", 2] }],
      transaction: true,
    }),
  )
  env.bridge.saveResult = save
  store.set(changeCellAtom, { tabId: id, row: 0, column: "name", value: "new" })
  expect(await store.set(saveEditsAtom, { tabId: id })).toBe(true)
  expect(save).toHaveBeenCalledWith(id, expect.any(String), "result", [
    { row: 0, column: "name", value: "new" },
  ])
  expect(query).not.toHaveBeenCalled()
  expect(store.get(activeQueryTabAtom)?.table.data[0].name).toBe("normalized")
  expect(store.get(activeQueryTabAtom)?.table.edits?.history).toEqual([])
  expect(store.get(activeQueryTabAtom)?.table.edits?.notice).toContain(
    "当前事务",
  )
})
test("local-only and unknown outcomes retain drafts and never retry writes", async () => {
  const id = await queryTab()
  const save = mock(async () => env.ok({ rows: [], transaction: false }))
  env.bridge.saveResult = save
  store.set(changeCellAtom, { tabId: id, row: 0, column: "computed", value: 8 })
  expect(await store.set(saveEditsAtom, { tabId: id })).toBe(false)
  expect(save).not.toHaveBeenCalled()
  store.set(discardEditsAtom, { tabId: id })
  store.set(changeCellAtom, { tabId: id, row: 0, column: "name", value: "new" })
  env.bridge.saveResult = async () => ({
    ok: false,
    kind: "unknown",
    error: "unknown commit",
    snapshot: env.capture(),
  })
  expect(await store.set(saveEditsAtom, { tabId: id })).toBe(false)
  expect(store.get(activeQueryTabAtom)?.table.edits?.uncertain).toBe(true)
  env.bridge.saveResult = save
  expect(await store.set(saveEditsAtom, { tabId: id })).toBe(false)
  expect(save).not.toHaveBeenCalled()
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes).toHaveLength(1)
})
test("query replacement and closing honor cancel, discard and submit choices", async () => {
  const id = await queryTab()
  const query = mock(env.bridge.query)
  env.bridge.query = query
  store.set(changeCellAtom, { tabId: id, row: 0, column: "name", value: "new" })
  env.system.confirmChanges = async () => "cancel"
  await store.set(runQueryAtom, { tabId: id })
  expect(query).not.toHaveBeenCalled()
  await store.set(closeTabAtom, id)
  expect(store.get(activeQueryTabAtom)?.id).toBe(id)
  env.system.confirmChanges = async () => "submit"
  env.bridge.saveResult = async () =>
    env.ok({ rows: [{ row: 0, values: [1, "new", 2] }], transaction: false })
  expect(await store.set(guardEditsAtom, id)).toBe(true)
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes).toEqual([])
  store.set(changeCellAtom, {
    tabId: id,
    row: 0,
    column: "name",
    value: "third",
  })
  env.system.confirmChanges = async () => "discard"
  await store.set(runQueryAtom, { tabId: id })
  expect(query).toHaveBeenCalledTimes(1)
  expect(store.get(activeQueryTabAtom)?.table.edits?.changes).toEqual([])
})
test("browse pagination retains local edits on cancel and submits before loading another page", async () => {
  env.bridge.select = async (_config, _tab, _request, query) =>
    env.ok({
      result: query.select ? { columns: [], rows: [[301]] } : result,
      executedSql: "SELECT",
    })
  const id = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  store.set(changeCellAtom, { tabId: id, row: 0, column: "name", value: "new" })
  await store.set(setViewPageAtom, { tabId: id, page: 2 })
  expect(store.get(activeViewTabAtom)?.table.offset).toBe(0)
  expect(store.get(activeViewTabAtom)?.table.edits?.changes).toHaveLength(1)
  env.system.confirmChanges = async () => "discard"
  await store.set(setViewPageAtom, { tabId: id, page: 2 })
  expect(store.get(activeViewTabAtom)?.table.edits?.changes).toEqual([])
})

test("rebuilding a session does not resurrect discarded or submitted drafts", async () => {
  for (const choice of ["discard", "submit"] as const) {
    const id = await queryTab()
    const session = store.get(activeQueryTabAtom)?.sessionId
    store.set(changeCellAtom, {
      tabId: id,
      row: 0,
      column: "name",
      value: "new",
    })
    env.system.confirmChanges = async () => choice
    env.bridge.saveResult = async () =>
      env.ok({ rows: [{ row: 0, values: [1, "new", 2] }], transaction: false })
    await store.set(rebuildSessionAtom, { tabId: id })
    const tab = store.get(activeQueryTabAtom)
    expect(tab?.sessionId).not.toBe(session)
    expect(tab?.table.edits?.changes).toEqual([])
    expect(tab?.table.data[0].name).toBe(choice === "submit" ? "new" : "before")
  }
})
