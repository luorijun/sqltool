import { atom, useAtomValue, useSetAtom } from "jotai"
import { Code2, Plus, Table2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/renderer/components/ui/button"
import { cn } from "@/renderer/components/ui/utils"
import {
  activeTabIdAtom,
  closeTabAtom,
  openQueryTabAtom,
  selectTabAtom,
  tabsAtom,
} from "@/renderer/modules/workspace"

type TabBarItem = {
  id: string
  label: string
  kind: "query" | "view"
  dirty: boolean
}

const tabsViewAtom = atom((get) =>
  get(tabsAtom).map((tab) => ({
    id: tab.id,
    label: tab.label,
    kind: tab.kind,
    dirty: false,
  })),
)

export function TabBar() {
  const tabs = useAtomValue(tabsViewAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(selectTabAtom)
  const openQueryTab = useSetAtom(openQueryTabAtom)
  const closeTab = useSetAtom(closeTabAtom)

  return (
    <div className="flex-none basis-10 flex items-stretch border-b bg-sidebar overflow-hidden">
      {/* Scrollable tab list */}
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-none">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={activeTabId === tab.id}
            onSelect={() => setActiveTabId(tab.id)}
            onClose={() => {
              void closeTab(tab.id).catch((error) =>
                toast.error(
                  error instanceof Error ? error.message : "关闭失败",
                ),
              )
            }}
          />
        ))}
      </div>

      {/* New tab button */}
      <div className="flex items-center px-1 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => openQueryTab()}
          title="新建查询"
        >
          <Plus />
        </Button>
      </div>
    </div>
  )
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TabBarItem
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <button
      type="button"
      data-active={active}
      className={cn(
        "group relative flex h-full items-center gap-1.5 border-r px-3 text-sm select-none shrink-0",
        "transition-colors",
        active
          ? "bg-background text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary after:content-['']"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onClick={onSelect}
      title={
        tab.kind === "view"
          ? `查看表：${tab.label}`
          : `自定义查询：${tab.label}`
      }
    >
      {/* Unsaved dot */}
      {tab.dirty && !active && (
        <span className="size-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
      )}

      {tab.kind === "view" ? (
        <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Code2 className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-35 truncate">{tab.label}</span>

      {/* Dirty indicator on active tab */}
      {tab.dirty && active && (
        <span className="size-1.5 rounded-full bg-primary shrink-0" />
      )}

      {/* Close button */}
      <span
        role="button"
        tabIndex={-1}
        aria-label={`关闭 ${tab.label}`}
        className={cn(
          "shrink-0 rounded p-0.5 transition-colors",
          "opacity-0 group-hover:opacity-100",
          active && "opacity-100",
          "hover:bg-muted text-muted-foreground hover:text-foreground",
        )}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <X className="size-3" />
      </span>
    </button>
  )
}
