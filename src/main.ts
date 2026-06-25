import path from "node:path"
import { app, BrowserWindow } from "electron"
import started from "electron-squirrel-startup"
import { updateElectronApp } from "update-electron-app"
import { initConn } from "./lib/conn/main"
import { initSerialize } from "./lib/serialize/main"

if (started) {
  app.quit()
} else {
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
        preload: path.join(__dirname, "preload.js"),
      },
    })

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
      mainWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      )
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

  await app.whenReady()
  updateElectronApp()
  initConn()
  initSerialize()
  createWindow()
}
