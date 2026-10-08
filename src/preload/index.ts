import { contextBridge } from "electron"
import type { MainBridge } from "@/contracts/bridge"
import conn from "./database"
import serialize from "./system"
import workspace from "./workspace"

contextBridge.exposeInMainWorld("main", {
  conn,
  serialize,
  workspace,
} satisfies MainBridge)
