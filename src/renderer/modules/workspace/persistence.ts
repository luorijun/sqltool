import { getDefaultStore } from "jotai"
import database from "@/renderer/modules/database"
import {
  reloadViewTabsAtom,
  restoreWorkspaceAtom,
  workspaceSnapshotAtom,
} from "./state"

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
