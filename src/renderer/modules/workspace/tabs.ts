import { atom } from "jotai"
import connApi, { connectionEntriesAtom } from "@/renderer/modules/database"
import { openings } from "./query"
import {
  activeIdAtom,
  createDefaultCodeView,
  createDefaultLoggerState,
  createDefaultQueryEditorState,
  createDefaultQueryTableState,
  createDefaultViewTableState,
  deleteTabState,
  tabOrderAtom,
  tabStatesAtom,
  updateQueryTabState,
} from "./state"
import type { QueryTabState, ViewTabState } from "./types"
import { loadViewTabCountByIdAtom, loadViewTabPageByIdAtom } from "./view"

let nextTabId = 1

export type OpenQueryTabOptions = {
  label?: string
  configId?: string
  initialSql?: string
}

export type OpenViewTabOptions = {
  configId: string
  source: {
    schema: string
    table: string
  }
}

export const openQueryTabAtom = atom(
  null,
  (_get, set, opts?: OpenQueryTabOptions) => {
    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "query",
      label: opts?.label ?? `查询 ${id}`,
      configId: opts?.configId,
      table: createDefaultQueryTableState(),
      editor: createDefaultQueryEditorState(opts?.initialSql),
      logger: createDefaultLoggerState(),
    } satisfies QueryTabState

    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(tabOrderAtom, (ids) => [...ids, id])
    set(activeIdAtom, id)
    return id
  },
)

export const openViewTabAtom = atom(
  null,
  async (get, set, opts: OpenViewTabOptions) => {
    const existing = Object.values(get(tabStatesAtom)).find(
      (tab): tab is ViewTabState =>
        tab.kind === "view" &&
        tab.configId === opts.configId &&
        tab.source.schema === opts.source.schema &&
        tab.source.table === opts.source.table,
    )
    if (existing) {
      set(activeIdAtom, existing.id)
      return existing.id
    }

    const id = String(nextTabId++)
    const tab = {
      id,
      kind: "view",
      label: opts.source.table,
      configId: opts.configId,
      source: { ...opts.source },
      table: createDefaultViewTableState(),
      code: createDefaultCodeView(),
      logger: createDefaultLoggerState(),
    } satisfies ViewTabState

    set(tabOrderAtom, (ids) => [...ids, id])
    set(tabStatesAtom, (states) => ({ ...states, [id]: tab }))
    set(activeIdAtom, id)

    await Promise.all([
      set(loadViewTabPageByIdAtom, { tabId: id }),
      set(loadViewTabCountByIdAtom, id),
    ])
    return id
  },
)

export const closeTabAtom = atom(null, async (get, set, tabId: string) => {
  const current = get(tabStatesAtom)[tabId]
  if (!current || current.closing) return
  set(tabStatesAtom, (states) => ({
    ...states,
    [tabId]: { ...states[tabId], closing: true },
  }))
  try {
    await openings.get(tabId)?.catch(() => {})
    if (!(await connApi.closeTab(tabId))) return
    const tabs = get(tabOrderAtom)
    const activeTabId = get(activeIdAtom)
    const closedIndex = tabs.indexOf(tabId)
    if (closedIndex === -1) {
      return
    }

    const nextTabs = tabs.filter((id) => id !== tabId)
    const nextActiveTabId =
      activeTabId !== null && activeTabId !== tabId
        ? activeTabId
        : nextTabs.length === 0
          ? null
          : nextTabs[Math.max(0, closedIndex - 1)]

    set(tabOrderAtom, nextTabs)
    set(activeIdAtom, nextActiveTabId)
    set(tabStatesAtom, (states) => deleteTabState(states, tabId))
  } finally {
    set(tabStatesAtom, (states) =>
      states[tabId]
        ? { ...states, [tabId]: { ...states[tabId], closing: false } }
        : states,
    )
  }
})

export const bindQueryConfigAtom = atom(
  null,
  async (
    get,
    set,
    { tabId, configId }: { tabId: string; configId?: string },
  ) => {
    const tab = get(tabStatesAtom)[tabId]
    if (
      tab?.kind !== "query" ||
      tab.closing ||
      tab.execution ||
      tab.configId === configId
    )
      return

    const exists = () =>
      !configId ||
      get(connectionEntriesAtom)?.some((entry) => entry.config.id === configId)
    if (!exists()) throw new Error("连接配置不存在或已删除")

    set(tabStatesAtom, (states) =>
      updateQueryTabState(states, tabId, (current) => ({
        ...current,
        closing: true,
      })),
    )
    try {
      if (tab.sessionId && !(await connApi.closeTab(tabId))) return
      if (!exists()) throw new Error("连接配置不存在或已删除")
      set(tabStatesAtom, (states) =>
        updateQueryTabState(states, tabId, (current) => ({
          ...current,
          configId,
          sessionId: undefined,
          execution: undefined,
        })),
      )
    } finally {
      set(tabStatesAtom, (states) =>
        updateQueryTabState(states, tabId, (current) => ({
          ...current,
          closing: false,
        })),
      )
    }
  },
)

export const selectTabAtom = atom(null, (get, set, id: string) => {
  if (get(tabStatesAtom)[id]) set(activeIdAtom, id)
})

export function reserveTabId(id: number): void {
  nextTabId = Math.max(nextTabId, id + 1)
}
