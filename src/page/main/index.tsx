import { useAtomValue } from "jotai"
import { hasTabsAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { EmptyPage } from "./empty-page"
import { TabBar } from "./tab-bar"
import TabPage from "./tab-page"

export default function Main(props: { className?: string }) {
  const hasTabs = useAtomValue(hasTabsAtom)
  return (
    <main
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden",
        props.className,
      )}
    >
      <TabBar />
      {hasTabs ? <TabPage /> : <EmptyPage />}
    </main>
  )
}
