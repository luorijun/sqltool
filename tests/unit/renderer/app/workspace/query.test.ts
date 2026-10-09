import { afterEach, beforeEach, expect, test } from "bun:test"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { useQueryCode, useQueryTable } from "@/renderer/app/workspace/query"
import {
  activeQueryTabAtom,
  openQueryTabAtom,
  selectTabAtom,
} from "@/renderer/modules/workspace"

const store = getDefaultStore()
let env: Awaited<ReturnType<typeof setupWorkspace>>
beforeEach(async () => {
  env = await setupWorkspace()
})
afterEach(async () => {
  await env.dispose()
})

function capture() {
  let code!: ReturnType<typeof useQueryCode>
  let table!: ReturnType<typeof useQueryTable>
  function Probe() {
    code = useQueryCode()
    table = useQueryTable()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return { code, table }
}

test("query callbacks retain their owning tab after the active tab changes", () => {
  const first = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  const { code, table } = capture()
  expect(code.canRun).toBe(true)
  const second = store.set(openQueryTabAtom, { initialSql: "SELECT 2" })
  code.onStateChange((current) => ({
    ...current,
    text: "SELECT 3",
    scroll: { top: 100, left: 0 },
  }))
  table.onLayoutChange((current) => ({ ...current, sizing: { n: 240 } }))
  expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 2")
  expect(store.get(activeQueryTabAtom)?.table.sizing).toEqual({})
  store.set(selectTabAtom, first)
  expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 3")
  expect(store.get(activeQueryTabAtom)?.editor.scroll.top).toBe(100)
  expect(store.get(activeQueryTabAtom)?.table.sizing).toEqual({ n: 240 })
  table.onReset()
  expect(store.get(activeQueryTabAtom)?.table.sizing).toEqual({})
  store.set(selectTabAtom, second)
  expect(capture().code.canRun).toBe(false)
})
