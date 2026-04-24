import path from "node:path"
import { app, BrowserWindow } from "electron"
import started from "electron-squirrel-startup"
import { registerHandlers as registerConfigHandlers } from "./lib/config/main"
import { registerHandlers as registerConnHandlers } from "./lib/conn/main"
import { registerHandlers as registerSerializeHandlers } from "./lib/serialize/main"

if (started) {
  app.quit()
}

try {
  registerConfigHandlers()
  registerConnHandlers()
  registerSerializeHandlers()
} catch (e) {
  console.error(e)
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  })

  // mainWindow.setMenu(null)

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    )
  }

  mainWindow.webContents.openDevTools()
}

app.on("ready", createWindow)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
