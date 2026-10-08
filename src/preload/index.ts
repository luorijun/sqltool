import { contextBridge, ipcRenderer } from "electron"
import { createBridge } from "./bridge"

contextBridge.exposeInMainWorld(
  "main",
  createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
)
