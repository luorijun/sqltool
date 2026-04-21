import { contextBridge } from "electron"
import { bridge as connBridge } from "./lib/conn/preload"
import { bridge as configBridge } from "./lib/config/preload"

contextBridge.exposeInMainWorld("main", {
  config: configBridge,
  conn: connBridge,
})
