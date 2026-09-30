import { describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { functionalUpdate, useTable } from "@tanstack/react-table"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { features } from "../../src/renderer/components/result-grid/features"
import { buildExportPayload } from "../../src/renderer/components/result-grid/menus"
import {
  normalizePinning,
  ResultTable,
} from "../../src/renderer/components/result-grid/table"
import {
  type ResultColumnDef,
  type ResultTableInstance,
  type ResultTableState,
  ROW_NUMBER_COLUMN_ID,
} from "../../src/renderer/components/result-grid/types"

function initialState(): ResultTableState {
  return {
    dataAt: null,
    data: [
      { amount: "10", name: "ten", hidden: "secret" },
      { amount: "2", name: "two", hidden: "secret" },
    ],
    columns: [
      { id: "amount", name: "Amount", typeFamily: "decimal" },
      { id: "name", name: "Name", typeFamily: "string" },
      { id: "hidden", name: "Hidden", typeFamily: "string" },
    ],
    visibility: { hidden: false },
    sizing: { amount: 180 },
    pinning: { start: ["name"], end: [] },
    selection: null,
  }
}

describe("result table migration", () => {
  test("keeps server row order while rendering sorting, hidden columns and pinned offsets", () => {
    const html = renderToStaticMarkup(
      createElement(ResultTable, {
        tableState: initialState(),
        readOnly: false,
        sortOrder: [],
        sorting: [{ id: "amount", desc: false }],
        onSortingChange: () => {},
        onLayoutChange: () => {},
        onReset: () => {},
        copyOptions: { format: "tsv", headers: false },
        onCopyOptionsChange: () => {},
        onSelectionChange: () => {},
        onExport: async () => {},
        onError: () => {},
      }),
    )
    const body = html.slice(html.indexOf("<tbody>"))
    expect(html).toContain("排序：Amount ↑")
    expect(body.indexOf('title="two"')).toBeGreaterThan(
      body.indexOf('title="ten"'),
    )
    expect(body).not.toContain("secret")
    expect(body).toContain("inset-inline-start:52px")
    expect(body).toContain("width:180px")
  })

  test("read-only results preserve row order and hide sorting controls", () => {
    const html = renderToStaticMarkup(
      createElement(ResultTable, {
        tableState: initialState(),
        readOnly: true,
        onLayoutChange: () => {},
        onReset: () => {},
        copyOptions: { format: "tsv", headers: false },
        onCopyOptionsChange: () => {},
        onSelectionChange: () => {},
        onExport: async () => {},
        onError: () => {},
      }),
    )
    const body = html.slice(html.indexOf("<tbody>"))
    expect(body.indexOf('title="ten"')).toBeLessThan(
      body.indexOf('title="two"'),
    )
    expect(html).not.toContain("点击排序")
    expect(html).not.toContain("当前排序")
    expect(html).not.toContain("按当前视图复制或导出")
  })

  test("controlled pinning keeps the row number first and exports visible data in server order", () => {
    let layout = initialState()
    let table!: ResultTableInstance
    function Probe() {
      table = useTable({
        features,
        data: layout.data,
        columns: [
          {
            id: ROW_NUMBER_COLUMN_ID,
            size: 52,
            enableHiding: false,
            enableResizing: false,
            enableSorting: false,
          },
          ...layout.columns.map<ResultColumnDef>((column) => ({
            id: column.id,
            accessorKey: column.id,
            header: column.name,
          })),
        ],
        state: {
          columnVisibility: layout.visibility,
          columnSizing: layout.sizing,
          columnPinning: normalizePinning(layout.pinning),
        },
        onColumnPinningChange: (updater) => {
          layout = {
            ...layout,
            pinning: normalizePinning(
              functionalUpdate(updater, normalizePinning(layout.pinning)),
            ),
          }
          table.setOptions((options) => ({
            ...options,
            state: {
              ...options.state,
              columnPinning: normalizePinning(layout.pinning),
            },
          }))
        },
        onColumnSizingChange: (updater) => {
          layout = {
            ...layout,
            sizing: functionalUpdate(updater, layout.sizing),
          }
          table.setOptions((options) => ({
            ...options,
            state: { ...options.state, columnSizing: layout.sizing },
          }))
        },
      })
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    expect(buildExportPayload(table).headers).toEqual(["Name", "Amount"])
    const name = table.getColumn("name")
    const amount = table.getColumn("amount")
    assert(name && amount)
    name.pin(false)
    amount.pin("start")
    name.pin("end")
    expect(layout.pinning).toEqual({
      start: [ROW_NUMBER_COLUMN_ID, "amount"],
      end: ["name"],
    })
    expect(amount.getStart("start")).toBe(52)
    expect(name.getAfter("end")).toBe(0)
    table.setColumnSizing((sizing) => ({ ...sizing, amount: 240 }))
    expect(amount.getSize()).toBe(240)
    expect(buildExportPayload(table)).toEqual({
      headers: ["Amount", "Name"],
      rows: [
        ["10", "ten"],
        ["2", "two"],
      ],
    })
    expect(table.getRowModel().rows[0].id).toBe("0")
  })
})

test("the grid renders cross-product selection, partial headers and a single data focus target", () => {
  const state = initialState()
  state.visibility = {}
  state.data.push({ amount: "3", name: "three", hidden: "third" })
  state.selection = {
    rows: [0, 2],
    columns: ["amount", "hidden"],
    anchor: { row: 0, col: "amount" },
    active: { row: 2, col: "hidden" },
    toggle: null,
  }
  const html = renderToStaticMarkup(
    createElement(ResultTable, {
      tableState: state,
      readOnly: true,
      onLayoutChange: () => {},
      onReset: () => {},
      onSelectionChange: () => {},
      copyOptions: { format: "tsv", headers: false },
      onCopyOptionsChange: () => {},
      onExport: async () => {},
      onError: () => {},
    }),
  )
  const cells = html.match(/<td[^>]*role="gridcell"[^>]*>/g) ?? []
  expect(
    cells.filter((cell) => cell.includes('aria-selected="true"')),
  ).toHaveLength(4)
  const headers = html.match(/<th[^>]*>/g) ?? []
  expect(
    headers.every((header) => !header.includes('aria-selected="true"')),
  ).toBe(true)
  expect(html).toContain('role="grid"')
  expect(html).toContain("aria-activedescendant=")
  expect(html.slice(html.indexOf("<tbody>"))).not.toContain("<button")
  expect(html.indexOf("导出本页")).toBeGreaterThan(html.indexOf("复制格式"))
  expect(html.indexOf("重置布局")).toBeLessThan(html.indexOf("复制格式"))
  expect(html).not.toContain("复制当前")
})

test("an empty selection retains a focus target without showing selected cells or a selection count", () => {
  const state = initialState()
  state.selection = {
    rows: [],
    columns: [],
    anchor: { row: 1, col: "amount" },
    active: { row: 1, col: "amount" },
    toggle: null,
  }
  const html = renderToStaticMarkup(
    createElement(ResultTable, {
      tableState: state,
      readOnly: true,
      onLayoutChange: () => {},
      onReset: () => {},
      onSelectionChange: () => {},
      copyOptions: { format: "tsv", headers: false },
      onCopyOptionsChange: () => {},
      onExport: async () => {},
      onError: () => {},
    }),
  )
  expect(html).toContain("aria-activedescendant=")
  expect(html).not.toContain('aria-selected="true"')
  expect(html).not.toContain("已选")
  expect(html).toContain('data-grid-pin="start"')
})
