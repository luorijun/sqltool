import { createDatabaseBridge } from "./database"
import type { Invoke } from "./invoke"
import { createSystemBridge } from "./system"
import { createWorkspaceBridge } from "./workspace"

export * from "./database"
export * from "./system"
export * from "./workspace"

export function createBridge(invoke: Invoke) {
  return {
    conn: createDatabaseBridge(invoke),
    system: createSystemBridge(invoke),
    workspace: createWorkspaceBridge(invoke),
  }
}
export type MainBridge = ReturnType<typeof createBridge>
export type DatabaseApi = MainBridge["conn"]
export type SystemApi = MainBridge["system"]
export type WorkspaceApi = MainBridge["workspace"]
