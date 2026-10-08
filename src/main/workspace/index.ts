import type { WorkspaceSnapshot } from "@/core/workspace"

export function createWorkspace(
  load: () => WorkspaceSnapshot | null,
  save: (snapshot: WorkspaceSnapshot) => void,
) {
  return {
    async load() {
      return load()
    },
    async save(snapshot: WorkspaceSnapshot) {
      save(snapshot)
    },
  }
}
export type Workspace = ReturnType<typeof createWorkspace>
