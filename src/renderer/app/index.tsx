import "./global.css"
import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import database from "@/renderer/modules/database"
import {
  activeTabIdAtom,
  reloadWorkspaceTables,
  restoreWorkspace,
  startWorkspaceSaving,
} from "@/renderer/modules/workspace"
import Workbench from "@/renderer/pages/workbench"

function syncConnections() {
  void database
    .sync()
    .catch((error) =>
      toast.error(error instanceof Error ? error.message : "状态同步失败"),
    )
}

function App() {
  const tabId = useAtomValue(activeTabIdAtom)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (tabId !== null) syncConnections()
  }, [tabId])
  useEffect(() => {
    let disposed = false
    let stop = () => {}
    const report = (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "工作区保存或恢复失败",
        { id: "workspace-persistence" },
      )
    void restoreWorkspace()
      .then(() => {
        if (disposed) return
        stop = startWorkspaceSaving(report)
        setReady(true)
        void reloadWorkspaceTables().catch(report)
      })
      .catch((error) => {
        report(error)
        if (!disposed) setReady(true)
      })
    window.addEventListener("focus", syncConnections)
    return () => {
      disposed = true
      stop()
      window.removeEventListener("focus", syncConnections)
    }
  }, [])
  return ready ? <Workbench /> : null
}

const root = document.getElementById("root")
if (!root) throw new Error("应用挂载节点不存在")
createRoot(root).render(<App />)
