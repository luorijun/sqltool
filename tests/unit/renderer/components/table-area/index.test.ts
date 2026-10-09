import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TableArea,
  type TableAreaProps,
} from "@/renderer/components/table-area"

const table: Extract<TableAreaProps, { mode: "query" }> = {
  mode: "query",
  id: "query",
  running: false,
  stale: false,
  tableState: {
    status: "idle",
    error: null,
    dataAt: null,
    data: [],
    columns: [],
    selection: null,
    visibility: {},
    sizing: {},
    pinning: { start: [], end: [] },
  },
  copyOptions: { format: "tsv", headers: false },
  onCopyOptionsChange: () => {},
  onSelectionChange: () => {},
  onLayoutChange: () => {},
  onReset: () => {},
  onExport: async () => {},
  onError: () => {},
}

test("query results retain prior rows on failure and use the execution loading state", () => {
  const idle = renderToStaticMarkup(createElement(TableArea, table))
  expect(idle).toContain("运行 SQL 语句以查看结果")
  const failed = {
    ...table,
    tableState: {
      ...table.tableState,
      status: "error" as const,
      error: "query failed",
    },
  }
  expect(renderToStaticMarkup(createElement(TableArea, failed))).toContain(
    "query failed",
  )
  const prior = {
    ...failed,
    tableState: {
      ...failed.tableState,
      dataAt: 1,
      columns: [{ id: "n", name: "n", typeFamily: "number" as const }],
      data: [{ n: 42 }],
    },
  }
  const html = renderToStaticMarkup(createElement(TableArea, prior))
  expect(html).toContain('title="42"')
  expect(html).toContain("此前执行的结果")
  expect(html).toContain("query failed")
  expect(html).not.toContain(">排序</button>")
  const loading = renderToStaticMarkup(
    createElement(TableArea, { ...prior, running: true }),
  )
  expect(loading).toContain("正在执行 SQL...")
  expect(loading).not.toContain('title="42"')
})
