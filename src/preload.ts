import { contextBridge } from "electron"
import config from "./lib/config/preload"
import conn from "./lib/conn/preload"
import serialize from "./lib/serialize/preload"

contextBridge.exposeInMainWorld("main", {
  config,
  conn,
  serialize,
})
