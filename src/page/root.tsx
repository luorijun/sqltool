import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { toast } from "sonner"
import { ResizeContainer } from "@/components/ui/resizer"
import { Toaster } from "@/components/ui/sonner"
import connApi from "@/lib/conn/renderer"
import { activeTabIdAtom } from "@/lib/tabs/renderer"
import { AppBar } from "./appbar"
import Main from "./main"
import Sidebar from "./sidebar"

const DEFAULT_NAV_WIDTH = 300
const MIN_NAV_WIDTH = 100
const MIN_MAIN_WIDTH = 500

function syncConnections() {
  void connApi
    .sync()
    .catch((error) =>
      toast.error(error instanceof Error ? error.message : "状态同步失败"),
    )
}

export default function Root() {
  const tabId = useAtomValue(activeTabIdAtom)
  useEffect(() => {
    if (tabId !== null) syncConnections()
  }, [tabId])
  useEffect(() => {
    syncConnections()
    window.addEventListener("focus", syncConnections)
    return () => window.removeEventListener("focus", syncConnections)
  }, [])
  return (
    <>
      <div className="h-screen w-screen flex flex-col overflow-hidden">
        <AppBar />
        <ResizeContainer
          axis="x"
          fixed="first"
          defaultSize={DEFAULT_NAV_WIDTH}
          minSize={MIN_NAV_WIDTH}
          minRemainingSize={MIN_MAIN_WIDTH}
          className="flex-1"
          dividerLabel="左右拖拽调节导航栏宽度"
          first={<Sidebar className="size-full" />}
          second={<Main className="size-full min-w-0" />}
        />
      </div>
      <Toaster />
    </>
  )
}
