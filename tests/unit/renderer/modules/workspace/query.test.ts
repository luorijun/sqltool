import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { config } from "@tests/support/renderer"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import type { QueryResult } from "@/core/database"
import type { ConnResponse } from "@/preload/bridge"
import client from "@/renderer/modules/database/client"
import {
  activeQueryRunningAtom,
  activeQueryTabAtom,
  activeResultStaleAtom,
  activeTabIdAtom,
  bindQueryConfigAtom,
  cancelQueryAtom,
  closeTabAtom,
  openQueryTabAtom,
  rebuildSessionAtom,
  runQueryAtom,
  selectTabAtom,
  tabsAtom,
} from "@/renderer/modules/workspace"

const store = getDefaultStore()
const result: QueryResult = {
  columns: [{ id: "n", name: "n", typeFamily: "number" }],
  rows: [[1]],
  rowCount: 1,
}
let env: Awaited<ReturnType<typeof setupWorkspace>>
let close: typeof env.bridge.closeTab
beforeEach(async () => {
  env = await setupWorkspace()
  close = env.bridge.closeTab
})
afterEach(async () => {
  await env.dispose()
})

test("query commands target an inactive tab and retain its result while running", async () => {
  const first = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  env.bridge.query = async () => env.ok(result)
  await store.set(runQueryAtom, { tabId: first })
  const before = store.get(activeQueryTabAtom)?.table
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
  const query = mock<typeof env.bridge.query>(() => {
    started.resolve()
    return pending.promise
  })
  env.bridge.query = query
  const second = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 2",
  })
  const running = store.set(runQueryAtom, { tabId: first })
  try {
    await started.promise
    expect(store.get(activeTabIdAtom)).toBe(second)
    expect(store.get(activeQueryRunningAtom)).toBe(false)
    store.set(selectTabAtom, first)
    expect(store.get(activeQueryRunningAtom)).toBe(true)
    expect(store.get(activeQueryTabAtom)?.table).toEqual(before)
    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "SELECT 1",
    )
    pending.resolve(env.ok(result))
    await running
    expect(store.get(activeQueryRunningAtom)).toBe(false)
    expect(store.get(activeQueryTabAtom)?.table.data).toEqual(before?.data)
  } finally {
    pending.resolve(env.ok(result))
    await running
  }
})

test("changing a connection preserves the draft and requires a successful close", async () => {
  env.snapshot.connections.push({
    ...env.snapshot.connections[0],
    config: { ...config, id: "other" },
  })
  await client.sync()
  const query = mock(async () => env.ok(result))
  env.bridge.query = query
  const tabId = store.set(openQueryTabAtom, { initialSql: "SELECT 1" })
  await store.set(bindQueryConfigAtom, { tabId, configId: "db" })
  expect(env.snapshot.sessions).toEqual([])
  expect(query).not.toHaveBeenCalled()
  await store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  const before = store.get(activeQueryTabAtom)
  env.bridge.closeTab = async () => env.ok(false)
  await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
  expect(store.get(activeQueryTabAtom)?.configId).toBe("db")
  env.bridge.closeTab = close
  await store.set(bindQueryConfigAtom, { tabId, configId: "other" })
  expect(store.get(activeQueryTabAtom)?.configId).toBe("other")
  expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 1")
  expect(store.get(activeQueryTabAtom)?.table.data).toEqual(before?.table.data)
  expect(store.get(activeResultStaleAtom)).toBe(true)
  expect(query).toHaveBeenCalledTimes(1)
})

test.each([
  ["open", false],
  ["closed", true],
] as const)(
  "late query results stay with the original tab (tab: %s)",
  async (_case, closed) => {
    const started = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
    env.bridge.query = () => {
      started.resolve()
      return pending.promise
    }
    const first = store.set(openQueryTabAtom, {
      configId: "db",
      initialSql: "SELECT 1",
    })
    const running = store.set(runQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    try {
      await started.promise
      const response = env.ok(result)
      const second = store.set(openQueryTabAtom, {
        initialSql: "second draft",
      })
      if (closed) await store.set(closeTabAtom, first)
      pending.resolve(response)
      await running
      expect(store.get(activeQueryTabAtom)?.id).toBe(second)
      expect(store.get(activeQueryTabAtom)?.editor.text).toBe("second draft")
      expect(store.get(activeQueryTabAtom)?.table.data).toEqual([])
      if (closed)
        expect(store.get(tabsAtom).some((tab) => tab.id === first)).toBe(false)
      else {
        store.set(selectTabAtom, first)
        expect(store.get(activeQueryTabAtom)?.table.status).toBe("success")
        expect(store.get(activeQueryTabAtom)?.table.data).toHaveLength(1)
      }
    } finally {
      pending.resolve(env.ok(result))
      await running
    }
  },
)

test("stopping during session creation prevents SQL and stays with the original tab", async () => {
  const started = Promise.withResolvers<void>()
  const opening = Promise.withResolvers<void>()
  const open = env.bridge.openSession
  env.bridge.openSession = async (...args) => {
    started.resolve()
    await opening.promise
    return open(...args)
  }
  const query = mock(async () => env.ok(result))
  const cancel = mock(async () => env.ok(undefined))
  env.bridge.query = query
  env.bridge.cancel = cancel
  const first = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  const running = store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  try {
    await started.promise
    await store.set(cancelQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    await store.set(cancelQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    const other = store.set(openQueryTabAtom, { initialSql: "other draft" })
    opening.resolve()
    await running
    expect(query).not.toHaveBeenCalled()
    expect(store.get(activeQueryTabAtom)).toMatchObject({
      id: other,
      editor: { text: "other draft" },
    })
    store.set(selectTabAtom, first)
    expect(store.get(activeQueryTabAtom)).toMatchObject({
      execution: undefined,
      log: { logs: [{ status: "cancelled" }] },
    })
  } finally {
    opening.resolve()
    await running
  }
})

test("failed cancellation can be retried without replaying the query", async () => {
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
  const query = mock(() => {
    started.resolve()
    return pending.promise
  })
  env.bridge.query = query
  let attempts = 0
  const cancel = mock(async () => {
    if (++attempts === 1) throw new Error("cancel denied")
    return env.ok(undefined)
  })
  env.bridge.cancel = cancel
  store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
  const running = store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  try {
    await started.promise
    await expect(
      store.set(cancelQueryAtom, {
        tabId: store.get(activeTabIdAtom) ?? "",
      }),
    ).rejects.toThrow("cancel denied")
    expect(
      store.get(activeQueryTabAtom)?.execution?.cancelRequested ?? false,
    ).toBe(false)
    await store.set(cancelQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    expect(cancel).toHaveBeenCalledTimes(2)
    pending.resolve(env.ok(result))
    await running
    expect(query).toHaveBeenCalledTimes(1)
    expect(store.get(activeQueryTabAtom)?.table.status).toBe("success")
    expect(
      store.get(activeQueryTabAtom)?.execution?.cancelRequested ?? false,
    ).toBe(false)
  } finally {
    pending.resolve(env.ok(result))
    await running
  }
})

test("rebuilding does not replay SQL and an older result cannot overwrite a new run", async () => {
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnResponse<QueryResult>>()
  const query = mock(() => {
    started.resolve()
    return pending.promise
  })
  env.bridge.query = query
  store.set(openQueryTabAtom, { configId: "db", initialSql: "SELECT 1" })
  const running = store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  try {
    await started.promise
    const old = env.ok(result)
    await store.set(rebuildSessionAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(store.get(activeQueryTabAtom)?.editor.text).toBe("SELECT 1")
    env.bridge.query = async () => env.ok({ ...result, rows: [[99]] })
    await store.set(runQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    const fresh = store.get(activeQueryTabAtom)?.table.data
    pending.resolve(old)
    await running
    expect(store.get(activeQueryTabAtom)?.table.data).toEqual(fresh)
    expect(
      store
        .get(activeQueryTabAtom)
        ?.log.logs.some((log) => log.status === "running"),
    ).toBe(false)
  } finally {
    pending.resolve(env.ok(result))
    await running
  }
})

test("closing before session creation completes prevents SQL execution", async () => {
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnResponse<string>>()
  env.bridge.openSession = () => {
    started.resolve()
    return pending.promise
  }
  const query = mock(async () => env.ok(result))
  env.bridge.query = query
  const id = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "DELETE FROM items",
  })
  const running = store.set(runQueryAtom, {
    tabId: store.get(activeTabIdAtom) ?? "",
  })
  try {
    await started.promise
    const closing = store.set(closeTabAtom, id)
    pending.resolve(env.ok("late-session"))
    await Promise.all([running, closing])
    expect(query).not.toHaveBeenCalled()
    expect(store.get(tabsAtom)).toEqual([])
  } finally {
    pending.resolve(env.ok("late-session"))
    await running
  }
})
