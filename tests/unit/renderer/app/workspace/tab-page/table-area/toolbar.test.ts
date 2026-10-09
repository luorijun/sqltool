import { afterEach, beforeEach, expect, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { QueryResult, SelectResult } from "@/core/database"
import type { ConnResponse } from "@/preload/bridge"
import ViewTableArea from "@/renderer/app/workspace/tab-page/table-area/view"
import {
  activeTabIdAtom,
  activeViewTabAtom,
  cancelViewAtom,
  openViewTabAtom,
  refreshViewAtom,
  selectTabAtom,
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

test("toolbar switches one refresh/stop control and hides both totals while either request runs", async () => {
  env.bridge.select = async (_config, _tab, _request, query) =>
    env.ok({
      result: query.select ? { ...result, rows: [[250]] } : result,
      executedSql: "page SQL",
    })
  await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "items" },
  })
  const render = () => renderToStaticMarkup(createElement(ViewTableArea))
  let html = render()
  expect(html).toContain("共 250 行")
  expect(html).toContain("第 1 / 3 页")
  expect(html).toContain(">刷新</button>")
  expect(html).not.toContain(">停止</button>")
  expect(html).toContain("排序：未排序")
  expect(html).toContain("未选择")
  const page = Promise.withResolvers<ConnResponse<SelectResult>>()
  const count = Promise.withResolvers<ConnResponse<SelectResult>>()
  env.bridge.select = (_config, _tab, _request, query) =>
    query.select ? count.promise : page.promise
  const refreshed = store.set(refreshViewAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  try {
    html = render()
    expect(html).toContain("共 - 行")
    expect(html).toContain("第 1 / - 页")
    expect(html).toContain(">停止</button>")
    expect(html).not.toContain(">刷新</button>")
    const loaded = Promise.withResolvers<void>()
    const unsubscribe = store.sub(activeViewTabAtom, () => {
      if (store.get(activeViewTabAtom)?.table.status === "success")
        loaded.resolve()
    })
    page.resolve(env.ok({ result, executedSql: "refreshed SQL" }))
    await loaded.promise
    unsubscribe()
    html = render()
    expect(html).toContain("共 - 行")
    expect(html).toContain(">停止</button>")
    count.resolve(
      env.ok({
        result: { ...result, rows: [[250]] },
        executedSql: "count SQL",
      }),
    )
    await refreshed
    expect(render()).toContain(">刷新</button>")
  } finally {
    page.resolve(env.ok({ result, executedSql: "page SQL" }))
    count.resolve(env.ok({ result, executedSql: "count SQL" }))
    await refreshed
  }
})

test("pending cancellation disables the stop control only on the owning tab", async () => {
  env.bridge.select = async () => env.ok({ result, executedSql: "page SQL" })
  const first = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "first" },
  })
  const other = await store.set(openViewTabAtom, {
    configId: "db",
    source: { schema: "public", table: "other" },
  })
  store.set(selectTabAtom, first)
  const page = Promise.withResolvers<ConnResponse<SelectResult>>()
  const pending = Promise.withResolvers<void>()
  env.bridge.select = () => page.promise
  env.bridge.cancel = async () => {
    await pending.promise
    return env.ok(undefined)
  }
  const running = store.set(refreshViewAtom, { tabId: first })
  const stopped = store.set(cancelViewAtom, { tabId: first })
  const render = () => renderToStaticMarkup(createElement(ViewTableArea))
  try {
    const html = render()
    const control = html.match(/<button[^>]*title="停止查询"[^>]*>/)?.[0]
    expect(control).toBeDefined()
    expect(control).toContain('disabled=""')
    expect(html).toContain("正在停止")
    store.set(selectTabAtom, other)
    expect(render()).toContain(">刷新</button>")
    expect(render()).not.toContain("正在停止")
    store.set(selectTabAtom, first)
    pending.resolve()
    await stopped
    expect(render()).toContain(">停止</button>")
    expect(render()).not.toContain("正在停止")
  } finally {
    pending.resolve()
    page.resolve(env.ok({ result, executedSql: "page SQL" }))
    await Promise.all([running, stopped])
  }
})
