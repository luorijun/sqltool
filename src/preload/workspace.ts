import type { WorkspaceSnapshot } from "@/core/workspace"
import type { Invoke } from "./invoke"

export const LOAD_WORKSPACE = "workspace:load"
export const SAVE_WORKSPACE = "workspace:save"

export function createWorkspaceBridge(invoke: Invoke) {
  return {
    load: () => invoke<WorkspaceSnapshot | null>(LOAD_WORKSPACE),
    save: (snapshot: WorkspaceSnapshot) =>
      invoke<void>(SAVE_WORKSPACE, snapshot),
  }
}
