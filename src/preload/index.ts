import { contextBridge } from "electron"
import type { MainBridge } from "@/contracts/bridge"
import conn from "./database"
import system from "./system"
import workspace from "./workspace"

contextBridge.exposeInMainWorld("main", {
  conn,
  system,
  workspace,
} satisfies MainBridge)
