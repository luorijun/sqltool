import Store from "electron-store"
import type { WorkspaceApi, WorkspaceSnapshot } from "@/contracts/workspace"

const store = new Store<{ snapshot: WorkspaceSnapshot }>({ name: "workspace" })

export const workspace: WorkspaceApi = {
  async load() {
    return store.get("snapshot") ?? null
  },
  async save(snapshot) {
    store.set("snapshot", snapshot)
  },
}
