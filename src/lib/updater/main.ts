import { app } from "electron"
import electronUpdater, { type AppUpdater } from "electron-updater"

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    return
  }

  const autoUpdater = getAutoUpdater()

  autoUpdater.on("error", (error) => {
    console.error("[updater] update failed", error)
  })

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error("[updater] check failed", error)
  })
}
