import { contextBridge } from "electron"
import { bridge as connectionBridge } from "./lib/connection/preload"

contextBridge.exposeInMainWorld("main", {
  connection: connectionBridge,
})
