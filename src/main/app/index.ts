import path from "node:path"
import { app, BrowserWindow } from "electron"
import { registerIpc } from "@/main/ipc"
import { initUpdater } from "@/main/updater"
import { database } from "./database"

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

  const owner = mainWindow.webContents.id
  let closing = false
  let approved = false
  mainWindow.on("close", (event) => {
    if (approved) return
    event.preventDefault()
    if (closing) return
    closing = true
    void database
      .closeOwner(owner)
      .then((closed) => {
        if (closed && !mainWindow.isDestroyed()) {
          approved = true
          mainWindow.close()
        }
      })
      .catch((error) => console.error("关闭会话失败", error))
      .finally(() => {
        closing = false
      })
  })
  mainWindow.webContents.on("render-process-gone", () => {
    void database
      .closeOwner(owner, true)
      .catch((error) => console.error("清理会话失败", error))
  })
  mainWindow.webContents.on("destroyed", () => {
    void database
      .closeOwner(owner, true)
      .catch((error) => console.error("清理会话失败", error))
  })
  // A renderer reload loses its tab ownership just like a destroyed renderer.
  mainWindow.webContents.on(
    "did-start-navigation",
    ({ isSameDocument, isMainFrame }) => {
      if (isMainFrame && !isSameDocument)
        void database
          .closeOwner(owner, true)
          .catch((error) => console.error("清理会话失败", error))
    },
  )

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
  registerIpc(database)
  initUpdater()
  createWindow()
})
