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
    selected: null,
  }
}

describe("result table migration", () => {
  test("keeps server row order while rendering sorting, hidden columns and pinned offsets", () => {
    const html = renderToStaticMarkup(
      createElement(ResultTable, {
        tableState: initialState(),
        readOnly: false,
        sorting: [{ id: "amount", desc: false }],
        onSortingChange: () => {},
        onLayoutChange: () => {},
        onReset: () => {},
        onCopy: async () => {},
        onExport: async () => {},
        onError: () => {},
      }),
    )
    const body = html.slice(html.indexOf("<tbody>"))
    expect(html).toContain("当前排序: Amount 升序")
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
        onCopy: async () => {},
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
