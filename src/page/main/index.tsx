import { useAtomValue } from "jotai"
import { tabsAtom } from "@/lib/tabs/renderer"
import { EmptyPage } from "./empty-page"
import { TabBar } from "./tab-bar"
import TabPage from "./tab-page"

export default function Main() {
  const hasTabs = useAtomValue(tabsAtom).length > 0
  return (
    <main className="col-start-2 col-span-1 flex min-h-0 flex-col overflow-hidden">
      <TabBar />
      {hasTabs ? <TabPage /> : <EmptyPage />}
    </main>
  )
}
