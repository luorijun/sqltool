import { describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { functionalUpdate, useTable } from "@tanstack/react-table"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { features } from "../../src/renderer/components/result-grid/features"
import { compareQueryValues } from "../../src/renderer/components/result-grid/format"
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
      { id: "name", name: "Name" },
      { id: "hidden", name: "Hidden" },
    ],
    visibility: { hidden: false },
    sizing: { amount: 180 },
    pinning: { start: ["name"], end: [] },
    selected: null,
    sorting: [{ id: "amount", desc: false }],
  }
}

describe("result table migration", () => {
  test("renders numeric sorting, hidden columns and pinned offsets", () => {
    const html = renderToStaticMarkup(
      createElement(ResultTable, {
        tableState: initialState(),
        onLayoutChange: () => {},
        onReset: () => {},
        onCopy: async () => {},
        onExport: async () => {},
        onError: () => {},
      }),
    )
    const body = html.slice(html.indexOf("<tbody>"))
    expect(html).toContain("当前排序: Amount 升序")
    expect(body.indexOf('title="two"')).toBeLessThan(
      body.indexOf('title="ten"'),
    )
    expect(body).not.toContain("secret")
    expect(body).toContain("inset-inline-start:52px")
    expect(body).toContain("width:180px")
  })

  test("controlled pinning keeps the row number first and exports sorted visible data", () => {
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
            sortFn: (a, b, id) =>
              compareQueryValues(a.getValue(id), b.getValue(id), column),
          })),
        ],
        state: {
          sorting: layout.sorting,
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
        ["2", "two"],
        ["10", "ten"],
      ],
    })
    expect(table.getRowModel().rows[0].id).toBe("1")
  })
})
