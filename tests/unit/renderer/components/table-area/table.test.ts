import { describe, expect, test } from "bun:test"
import { useTable } from "@tanstack/react-table"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { buildExportPayload } from "@/renderer/components/table-area/menus"
import {
  features,
  type ResultColumnDef,
  type ResultTableInstance,
  type ResultTableState,
  ROW_NUMBER_COLUMN_ID,
} from "@/renderer/components/table-area/model"
import {
  normalizePinning,
  ResultTable,
} from "@/renderer/components/table-area/table"

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

describe("result table component contract", () => {
  test("keeps server row order while rendering sorting and hidden columns", () => {
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
    expect(html).toContain("排序：Amount↑")
    expect(html).toContain(">排序</button>")
    expect(body).toContain('title="ten"')
    expect(body).toContain('title="two"')
    expect(body.indexOf('title="two"')).toBeGreaterThan(
      body.indexOf('title="ten"'),
    )
    expect(body).not.toContain("secret")
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
    expect(body).toContain('title="ten"')
    expect(body).toContain('title="two"')
    expect(body.indexOf('title="ten"')).toBeLessThan(
      body.indexOf('title="two"'),
    )
    expect(html).not.toContain(">排序</button>")
    expect(html).not.toContain("排序：")
    expect(html).not.toContain("aria-sort=")
  })

  test("pinning normalization keeps the row number first and export uses visible columns in server order", () => {
    const layout = initialState()
    const pinning = normalizePinning({
      start: ["name", ROW_NUMBER_COLUMN_ID],
      end: [ROW_NUMBER_COLUMN_ID, "amount"],
    })
    expect(pinning).toEqual({
      start: [ROW_NUMBER_COLUMN_ID, "name"],
      end: ["amount"],
    })
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
          columnPinning: pinning,
        },
      })
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    expect(buildExportPayload(table)).toEqual({
      headers: ["Name", "Amount"],
      rows: [
        ["ten", "10"],
        ["two", "2"],
      ],
    })
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
  for (const label of ["导出本页", "复制格式", "重置布局"])
    expect(html).toContain(label)
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
})
