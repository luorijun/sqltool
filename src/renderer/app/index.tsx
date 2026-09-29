import "./global.css"
import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import database from "@/renderer/modules/database"
import { activeTabIdAtom } from "@/renderer/modules/workspace"
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
  useEffect(() => {
    if (tabId !== null) syncConnections()
  }, [tabId])
  useEffect(() => {
    syncConnections()
    window.addEventListener("focus", syncConnections)
    return () => window.removeEventListener("focus", syncConnections)
  }, [])
  return <Workbench />
}

const root = document.getElementById("root")
if (!root) throw new Error("应用挂载节点不存在")
createRoot(root).render(<App />)
