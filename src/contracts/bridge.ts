import type { DatabaseApi } from "@/contracts/database"
import type { SystemApi } from "@/contracts/system"
import type { WorkspaceApi } from "@/contracts/workspace"

export interface MainBridge {
  conn: DatabaseApi
  serialize: SystemApi
  workspace: WorkspaceApi
}
