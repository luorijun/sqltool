import { contextBridge } from "electron"
import conn from "./lib/conn/preload"
import serialize from "./lib/serialize/preload"

contextBridge.exposeInMainWorld("main", {
  conn,
  serialize,
})
