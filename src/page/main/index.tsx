import { useAtomValue } from "jotai"
import { hasActiveTabAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { EmptyPage } from "./empty-page"
import { TabBar } from "./tab-bar"
import TabPage from "./tab-page"

export default function Main(props: { className?: string }) {
  const hasActiveTab = useAtomValue(hasActiveTabAtom)
  return (
    <main
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden",
        props.className,
      )}
    >
      <TabBar />
      {hasActiveTab ? <TabPage /> : <EmptyPage />}
    </main>
  )
}
