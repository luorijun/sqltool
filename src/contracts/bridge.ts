import type { DatabaseApi } from "@/contracts/database"
import type { SystemApi } from "@/contracts/system"

export interface MainBridge {
  conn: DatabaseApi
  serialize: SystemApi
}
