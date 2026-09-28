import { contextBridge } from "electron"
import type { MainBridge } from "@/contracts/bridge"
import conn from "./database"
import serialize from "./system"

contextBridge.exposeInMainWorld("main", {
  conn,
  serialize,
} satisfies MainBridge)
