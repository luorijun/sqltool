import { contextBridge } from "electron"
import { bridge as configBridge } from "./lib/config/preload"

contextBridge.exposeInMainWorld("main", {
  config: configBridge,
})
