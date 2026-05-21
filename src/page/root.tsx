import { ResizeContainer } from "@/components/ui/resizer"
import { Toaster } from "@/components/ui/sonner"
import { AppBar } from "./appbar"
import Main from "./main"
import Sidebar from "./sidebar"

const DEFAULT_NAV_WIDTH = 300
const MIN_NAV_WIDTH = 100
const MIN_MAIN_WIDTH = 500

export default function Root() {
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
