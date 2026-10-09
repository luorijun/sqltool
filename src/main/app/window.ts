import path from "node:path"
import { BrowserWindow, dialog } from "electron"
import type { Confirm, Sessions } from "@/main/sessions"
import { hasResultChanges, setResultChanges } from "@/main/system"

const appDir = import.meta.dirname

export const createWindow = (sessions: Sessions) => {
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
    void (async () => {
      if (hasResultChanges(owner)) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question",
          message: "结果中有未提交的修改，仍要退出吗？",
          detail: "返回表格可以提交、复制或导出修改后的数据。",
          buttons: ["返回", "放弃修改并退出"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (result.response !== 1) return false
      }
      return sessions.closeOwner(owner)
    })()
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
    setResultChanges(owner, false)
    void sessions
      .closeOwner(owner, true)
      .catch((error) => console.error("清理会话失败", error))
  })
  mainWindow.webContents.on("destroyed", () => {
    void sessions
      .closeOwner(owner, true)
      .catch((error) => console.error("清理会话失败", error))
  })
  // A renderer reload loses its tab ownership just like a destroyed renderer.
  mainWindow.webContents.on(
    "did-start-navigation",
    ({ isSameDocument, isMainFrame }) => {
      if (isMainFrame && !isSameDocument) {
        setResultChanges(owner, false)
        void sessions
          .closeOwner(owner, true)
          .catch((error) => console.error("清理会话失败", error))
      }
    },
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(appDir, "../renderer/index.html"))
  }
}

export const confirmClose: Confirm = async (owner, message, detail, kind) => {
  const window = BrowserWindow.getAllWindows().find(
    (w) => w.webContents.id === owner,
  )
  if (!window || window.isDestroyed()) return false
  const result = await dialog.showMessageBox(window, {
    type: "warning",
    message,
    detail,
    buttons: [
      "返回",
      {
        stop: "停止任务并继续关闭",
        rollback: "回滚并关闭",
        unknown: "尝试回滚并关闭",
        force: "强制断开",
      }[kind],
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return result.response === 1
}
