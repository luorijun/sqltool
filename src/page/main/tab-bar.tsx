import { Plus, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tab {
  id: string
  label: string
  /** Unsaved changes indicator */
  dirty?: boolean
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_TABS: Tab[] = [
  { id: "1", label: "查询 1" },
  { id: "2", label: "查询 2", dirty: true },
]

let nextTabId = 3

// ─── Tab Item ─────────────────────────────────────────────────────────────────

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: Tab
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
    >
      {/* Unsaved dot */}
      {tab.dirty && !active && (
        <span className="size-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
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

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

export function TabBar() {
  const [tabs, setTabs] = useState<Tab[]>(INITIAL_TABS)
  const [activeId, setActiveId] = useState<string>("1")

  const addTab = () => {
    const id = String(nextTabId++)
    const newTab: Tab = { id, label: `查询 ${id}` }
    setTabs((prev) => [...prev, newTab])
    setActiveId(id)
  }

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id && next.length > 0) {
        // Activate the tab to the left, or the last one
        const closedIndex = prev.findIndex((t) => t.id === id)
        const newActive = next[Math.max(0, closedIndex - 1)]
        setActiveId(newActive.id)
      }
      return next
    })
  }

  return (
    <div className="flex-none basis-10 flex items-stretch border-b bg-sidebar overflow-hidden">
      {/* Scrollable tab list */}
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-none">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={activeId === tab.id}
            onSelect={() => setActiveId(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </div>

      {/* New tab button */}
      <div className="flex items-center px-1 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={addTab}
          title="新建查询"
        >
          <Plus />
        </Button>
      </div>
    </div>
  )
}
