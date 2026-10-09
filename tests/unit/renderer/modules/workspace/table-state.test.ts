import { afterEach, beforeEach, expect, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import type { QueryResult } from "@/core/database"
import {
  activeQueryTabAtom,
  activeTabIdAtom,
  activeViewTabAtom,
  copyOptionsAtom,
  openQueryTabAtom,
  openViewTabAtom,
  runQueryAtom,
  selectTabAtom,
  setCopyOptionsAtom,
  setTableSelectionAtom,
  setViewPageSizeAtom,
  updateQueryLayoutAtom,
  updateViewLayoutAtom,
} from "@/renderer/modules/workspace"

const store = getDefaultStore()
const result: QueryResult = {
  columns: [{ id: "n", name: "n", typeFamily: "number" }],
  rows: [[1]],
  rowCount: 1,
}
let env: Awaited<ReturnType<typeof setupWorkspace>>
beforeEach(async () => {
  env = await setupWorkspace()
})
afterEach(async () => {
  await env.dispose()
})

test("table selection is tab-owned, survives sizing, and is cleared by result or column changes", async () => {
  env.bridge.query = async () => env.ok(result)
  env.bridge.select = async () => env.ok({ result, executedSql: "SELECT n" })
  const selection = {
    rows: [0],
    columns: ["n"],
    anchor: { row: 0, col: "n" },
    active: { row: 0, col: "n" },
    toggle: {
      rows: [],
      columns: [],
      mode: "cells" as const,
      operation: "add" as const,
    },
  }
  const query = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  await store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  store.set(setTableSelectionAtom, { tabId: query, selection })
  store.set(updateQueryLayoutAtom, {
    tabId: query,
    update: (current) => ({ ...current, sizing: { n: 200 } }),
  })
  expect(store.get(activeQueryTabAtom)?.table.selection).toEqual(selection)
  const view = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: view, selection })
  store.set(updateViewLayoutAtom, {
    tabId: view,
    update: (current) => ({ ...current, pinning: { start: ["n"], end: [] } }),
  })
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: view, selection })
  await store.set(setViewPageSizeAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
    limit: 50,
  })
  expect(store.get(activeViewTabAtom)?.table.selection).toBeNull()
  store.set(selectTabAtom, query)
  expect(store.get(activeQueryTabAtom)?.table.selection).toEqual(selection)
  store.set(updateQueryLayoutAtom, {
    tabId: query,
    update: (current) => ({ ...current, visibility: { n: false } }),
  })
  expect(store.get(activeQueryTabAtom)?.table.selection).toBeNull()
  store.set(setTableSelectionAtom, { tabId: query, selection })
  await store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  expect(store.get(activeQueryTabAtom)?.table.selection).toBeNull()
})

test("copy preferences are shared across tabs independently of selection and layout", () => {
  const first = store.set(openQueryTabAtom)
  store.set(setCopyOptionsAtom, { format: "json", headers: true })
  const second = store.set(openQueryTabAtom)
  expect(store.get(copyOptionsAtom)).toEqual({ format: "json", headers: true })
  store.set(selectTabAtom, first)
  expect(store.get(copyOptionsAtom).format).toBe("json")
  store.set(selectTabAtom, second)
  store.set(setCopyOptionsAtom, { format: "tsv", headers: false })
})
