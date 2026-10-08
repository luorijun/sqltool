import { atom, getDefaultStore } from "jotai"
import type { WorkspaceSnapshot } from "@/contracts/workspace"
import database from "@/renderer/modules/database"
import {
  activeIdAtom,
  createCodeView,
  createLog,
  createQueryEditor,
  createQueryTable,
  createViewTable,
  type TabStateMap,
  tabOrderAtom,
  tabStatesAtom,
} from "./state"
import { reserveTabId } from "./tabs"
import { reloadViewTabsAtom } from "./view"

export const workspaceSnapshotAtom = atom<WorkspaceSnapshot>((get) => {
  const states = get(tabStatesAtom)
  return {
    version: 1,
    activeTabId: get(activeIdAtom),
    tabs: get(tabOrderAtom).map((id): WorkspaceSnapshot["tabs"][number] => {
      const tab = states[id]
      const meta = { id, label: tab.label }
      if (tab.kind === "query") {
        const { text, cursor, selections, mainSelectionIndex, scroll, search } =
          tab.editor
        return {
          ...meta,
          kind: "query",
          configId: tab.configId,
          editor: {
            text,
            cursor,
            selections,
            mainSelectionIndex,
            scroll,
            search,
          },
        }
      }
      const { sort, sortOrder, offset, limit } = tab.table
      return {
        ...meta,
        kind: "view",
        configId: tab.configId,
        source: tab.source,
        sort,
        sortOrder,
        offset,
        limit,
      }
    }),
  }
})

export const restoreWorkspaceAtom = atom(
  null,
  (get, set, snapshot: WorkspaceSnapshot) => {
    if (get(tabOrderAtom).length) throw new Error("仅能在空工作区中恢复页面")
    const states: TabStateMap = {}
    const tabs: string[] = []
    for (const tab of snapshot.tabs) {
      tabs.push(tab.id)
      const id = Number(tab.id)
      if (Number.isSafeInteger(id) && id >= 0) reserveTabId(id)
      states[tab.id] =
        tab.kind === "query"
          ? {
              id: tab.id,
              label: tab.label,
              kind: "query",
              configId: tab.configId,
              editor: { ...createQueryEditor(), ...tab.editor },
              table: createQueryTable(),
              log: createLog(),
            }
          : {
              id: tab.id,
              label: tab.label,
              kind: "view",
              configId: tab.configId,
              source: tab.source,
              table: {
                ...createViewTable(),
                sort: tab.sort,
                sortOrder: tab.sortOrder,
                offset: tab.offset,
                limit: tab.limit,
              },
              code: createCodeView(),
              log: createLog(),
            }
    }
    set(tabStatesAtom, states)
    set(tabOrderAtom, tabs)
    set(
      activeIdAtom,
      snapshot.activeTabId && states[snapshot.activeTabId]
        ? snapshot.activeTabId
        : (tabs[0] ?? null),
    )
  },
)

export async function restoreWorkspace(): Promise<void> {
  const [snapshot] = await Promise.all([
    window.main.workspace.load(),
    database.sync(),
  ])
  if (snapshot) getDefaultStore().set(restoreWorkspaceAtom, snapshot)
}

export function reloadWorkspaceTables(): Promise<void> {
  return getDefaultStore().set(reloadViewTabsAtom)
}

export function startWorkspaceSaving(
  onError: (error: unknown) => void,
  interval = 5000,
): () => void {
  const store = getDefaultStore()
  let saved = JSON.stringify(store.get(workspaceSnapshotAtom))
  let saving = false

  async function save() {
    if (saving) return
    const snapshot = store.get(workspaceSnapshotAtom)
    const value = JSON.stringify(snapshot)
    if (value === saved) return
    saving = true
    try {
      await window.main.workspace.save(snapshot)
      saved = value
    } catch (error) {
      onError(error)
    } finally {
      saving = false
    }
  }

  const timer = setInterval(() => void save(), interval)
  return () => clearInterval(timer)
}
