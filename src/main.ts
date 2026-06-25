import path from "node:path"
import { app, BrowserWindow } from "electron"
import { initConn } from "./lib/conn/main"
import { initSerialize } from "./lib/serialize/main"
import { initUpdater } from "./lib/updater/main"

const appDir = import.meta.dirname

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    center: true,
    title: "SqlTool",
    titleBarStyle: "hidden",
    backgroundColor: "#fafafa",
    titleBarOverlay: {
      color: "#fafafa",
      symbolColor: "#111827",
      height: 40,
    },
    webPreferences: {
      preload: path.join(appDir, "../preload/index.cjs"),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(appDir, "../renderer/index.html"))
  }
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.whenReady().then(() => {
  initConn()
  initSerialize()
  initUpdater()
  createWindow()
})
