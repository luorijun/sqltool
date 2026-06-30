import { useAtomValue } from "jotai"
import { activeTabAtom } from "@/lib/tabs/renderer"
import { QueryTabPage } from "./query"

export default function TabPage() {
  const tab = useAtomValue(activeTabAtom)

  if (!tab) {
    return null
  }

  switch (tab.kind) {
    case "query":
      return <QueryTabPage />
    case "view":
      return <ViewTabPage />
  }
}

function ViewTabPage() {
  return (
    <div className="flex size-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
      View tab 页面尚未实现
    </div>
  )
}
