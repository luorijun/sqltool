import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { clock } from "@tests/support/async"
import { setupWorkspace } from "@tests/support/workspace"
import { getDefaultStore } from "jotai"
import type { WorkspaceSnapshot } from "@/core/workspace"
import {
  activeTabIdAtom,
  openQueryTabAtom,
  runQueryAtom,
  updateQueryEditorAtom,
} from "@/renderer/modules/workspace"
import { startWorkspaceSaving } from "@/renderer/modules/workspace/persistence"

const store = getDefaultStore()
const result = {
  columns: [{ id: "n", name: "n", typeFamily: "number" as const }],
  rows: [[1]],
}
let env: Awaited<ReturnType<typeof setupWorkspace>>
let time: ReturnType<typeof clock>
const closeTabs = async () => {
  await env.closeTabs()
}
beforeEach(async () => {
  env = await setupWorkspace()
  time = clock()
  env.bridge.query = mock(async () => env.ok(result))
})
afterEach(async () => {
  try {
    await env.dispose()
  } finally {
    time.restore()
  }
})

test("periodically saves edits and ignores query results and logs", async () => {
  const tabId = store.set(openQueryTabAtom, {
    configId: "db",
    initialSql: "SELECT 1",
  })
  const save = mock(async (_snapshot: WorkspaceSnapshot) => {})
  env.workspace.save = save
  const onError = mock()
  const stop = startWorkspaceSaving(onError, 10)
  try {
    await time.advance(30)
    expect(save).not.toHaveBeenCalled()
    await store.set(runQueryAtom, {
      tabId: store.get(activeTabIdAtom) ?? "",
    })
    await time.advance(30)
    expect(save).not.toHaveBeenCalled()
    store.set(updateQueryEditorAtom, {
      tabId,
      update: (editor) => ({ ...editor, text: "SELECT 2" }),
    })
    await time.advance(30)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].tabs[0]).toMatchObject({
      editor: { text: "SELECT 2" },
    })
    await time.advance(30)
    expect(save).toHaveBeenCalledTimes(1)
    await closeTabs()
    await time.advance(30)
    expect(save.mock.calls.at(-1)?.[0]).toEqual({
      version: 1,
      activeTabId: null,
      tabs: [],
    })
    expect(onError).not.toHaveBeenCalled()
  } finally {
    stop()
  }
  store.set(openQueryTabAtom)
  const count = save.mock.calls.length
  await time.advance(30)
  expect(save).toHaveBeenCalledTimes(count)
})

test("slow writes never overlap and the next write contains the latest draft", async () => {
  const queryId = store.set(openQueryTabAtom, { initialSql: "old draft" })
  const pending = Promise.withResolvers<void>()
  const save = mock(async (_snapshot: WorkspaceSnapshot) => {
    await pending.promise
  })
  env.workspace.save = save
  const stop = startWorkspaceSaving(mock(), 10)
  try {
    store.set(updateQueryEditorAtom, {
      tabId: queryId,
      update: (editor) => ({ ...editor, text: "new draft" }),
    })
    await time.advance(10)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].tabs[0]).toMatchObject({
      editor: { text: "new draft" },
    })
    store.set(updateQueryEditorAtom, {
      tabId: queryId,
      update: (editor) => ({ ...editor, text: "latest draft" }),
    })
    await time.advance(30)
    expect(save).toHaveBeenCalledTimes(1)
    pending.resolve()
    await time.advance(10)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].tabs[0]).toMatchObject({
      editor: { text: "latest draft" },
    })
  } finally {
    pending.resolve()
    stop()
  }
})

test("failed saves report the error and retry the current snapshot on the next tick", async () => {
  const id = store.set(openQueryTabAtom, { initialSql: "old" })
  const error = new Error("disk unavailable")
  const save = mock(async (_snapshot: WorkspaceSnapshot) => {
    if (save.mock.calls.length === 1) throw error
  })
  env.workspace.save = save
  const report = mock()
  const stop = startWorkspaceSaving(report, 10)
  try {
    store.set(updateQueryEditorAtom, {
      tabId: id,
      update: (editor) => ({ ...editor, text: "first edit" }),
    })
    await time.advance(10)
    expect(report).toHaveBeenCalledWith(error)
    store.set(updateQueryEditorAtom, {
      tabId: id,
      update: (editor) => ({ ...editor, text: "latest edit" }),
    })
    await time.advance(10)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].tabs[0]).toMatchObject({
      editor: { text: "latest edit" },
    })
    await time.advance(30)
    expect(save).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})
