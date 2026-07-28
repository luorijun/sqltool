import { useAtomValue } from "jotai"
import { activeTabAtom } from "@/lib/tabs/renderer"
import { QueryTabPage } from "./query"
import { ViewTabPage } from "./view"

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
