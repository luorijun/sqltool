import { contextBridge } from "electron"
import { bridge as configBridge } from "./lib/config/preload"
import { bridge as connBridge } from "./lib/conn/preload"
import { bridge as serializeBridge } from "./lib/serialize/preload"

contextBridge.exposeInMainWorld("main", {
  config: configBridge,
  conn: connBridge,
  serialize: serializeBridge,
})
