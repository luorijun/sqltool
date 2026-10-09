import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  CodeArea,
  type CodeAreaProps,
  type EditorState,
} from "@/renderer/components/code-area"

const state: EditorState = {
  text: "SELECT 1",
  cursor: { line: 1, col: 1 },
  selections: [{ anchor: 0, head: 0 }],
  mainSelectionIndex: 0,
  scroll: { top: 0, left: 0 },
  search: {
    query: "",
    replace: "",
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
    open: false,
  },
}
const base = {
  id: "query",
  state,
  configId: "db",
  connections: [
    {
      id: "db",
      name: "Local",
      database: "test",
      host: "localhost",
      port: "5432",
    },
  ],
  onStateChange: () => {},
  onError: () => {},
}
const query: Extract<CodeAreaProps, { mode: "query" }> = {
  ...base,
  mode: "query",
  running: false,
  failed: false,
  closing: false,
  cancelling: false,
  canRun: true,
  status: "首次执行时连接",
  onRun: () => {},
  onCancel: () => {},
  onRebuild: () => {},
  onConfigChange: () => {},
}

test("code area renders from supplied configuration without a workspace or database client", () => {
  const html = renderToStaticMarkup(createElement(CodeArea, query))
  expect(html).toContain("Local")
  expect(html).toContain("首次执行时连接")
  expect(html).toContain(">运行</button>")
  expect(html).toContain(">格式化</button>")
  expect(html).not.toContain("重建会话</button>")
})

test("pending cancellation retains execution controls and disables repeated actions", () => {
  const html = renderToStaticMarkup(
    createElement(CodeArea, {
      ...query,
      running: true,
      cancelling: true,
      canRun: false,
    }),
  )
  expect(html).toContain("取消中")
  expect(html).toContain("断开并重建")
  expect(
    html.match(/<button[^>]*title="运行 SQL \(F5\)"[^>]*>/)?.[0],
  ).toContain('disabled=""')
  const cancel = html
    .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
    ?.find((button) => button.includes("取消中"))
  expect(cancel).toContain('disabled=""')
})

test("browse code keeps prior-result context and exposes a read-only configuration", () => {
  const html = renderToStaticMarkup(
    createElement(CodeArea, {
      ...base,
      mode: "view",
      status: "此前结果的 SQL",
      notice: "此前结果",
    }),
  )
  expect(html).toContain("数据查询 · 只读")
  expect(html).toContain("此前结果的 SQL")
  expect(html).toContain("只读查询，不可修改绑定配置")
  expect(html).toContain(">搜索</button>")
  expect(html).not.toContain(">运行</button>")
  expect(html).not.toContain(">格式化</button>")
})
