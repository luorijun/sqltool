import { atom, useAtomValue, useSetAtom } from "jotai"
import { Code2, FilePlus2, Plus, Table2, X } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { cn } from "tailwind-variants"
import { CodeArea } from "@/renderer/components/code-area"
import { LogArea, type LogView } from "@/renderer/components/log-area"
import { TableArea } from "@/renderer/components/table-area"
import { Button } from "@/renderer/components/ui/button"
import { ResizeContainer } from "@/renderer/components/ui/resizer"
import {
  activeLogAtom,
  activeTabAtom,
  activeTabIdAtom,
  clearLogsAtom,
  closeTabAtom,
  openQueryTabAtom,
  selectTabAtom,
  tabsAtom,
  updateLogViewAtom,
} from "@/renderer/modules/workspace"
import { copyText, showError } from "./feedback"
import { useQueryCode, useQueryTable } from "./query"
import { useViewCode, useViewTable } from "./view"

export default function Workspace(props: { className?: string }) {
  return (
    <main
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden",
        props.className,
      )}
    >
      <TabBar />
      <TabPage />
    </main>
  )
}

type TabBarItem = {
  id: string
  label: string
  kind: "query" | "view"
}

function TabBar() {
  const tabs = useAtomValue(tabsAtom)
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
      {tab.kind === "view" ? (
        <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Code2 className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-35 truncate">{tab.label}</span>

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

const tabKindAtom = atom((get) => get(activeTabAtom)?.kind ?? null)

function TabPage() {
  const kind = useAtomValue(tabKindAtom)
  if (!kind) return <EmptyPage />
  return kind === "query" ? <QueryPage /> : <ViewPage />
}

function QueryPage() {
  return (
    <PageLayout ratio={1 / 3} code={<QueryCode />} table={<QueryTable />} />
  )
}

function ViewPage() {
  return <PageLayout ratio={3 / 4} code={<ViewCode />} table={<ViewTable />} />
}

function QueryCode() {
  return <CodeArea {...useQueryCode()} />
}

function QueryTable() {
  return <TableArea {...useQueryTable()} />
}

function ViewCode() {
  const props = useViewCode()
  return props ? <CodeArea {...props} /> : null
}

function ViewTable() {
  const props = useViewTable()
  return props ? <TableArea {...props} /> : null
}

const MIN_TABLE_HEIGHT = 80
const MIN_BOTTOM_HEIGHT = 120
const MIN_LOG_WIDTH = 240
const MIN_CODE_WIDTH = 160

function PageLayout({
  code,
  table,
  ratio,
}: {
  code: ReactNode
  table: ReactNode
  ratio: number
}) {
  return (
    <ResizeContainer
      axis="y"
      fixed="first"
      defaultSize={(containerHeight) => containerHeight * ratio}
      minSize={MIN_TABLE_HEIGHT}
      minRemainingSize={MIN_BOTTOM_HEIGHT}
      className="flex-1 min-h-0"
      dividerLabel="上下拖拽调节结果区高度"
      first={table}
      second={
        <ResizeContainer
          axis="x"
          fixed="second"
          defaultSize={(containerWidth) => containerWidth / 3}
          minSize={MIN_LOG_WIDTH}
          minRemainingSize={MIN_CODE_WIDTH}
          className="size-full min-h-0"
          dividerLabel="左右拖拽调节日志区宽度"
          first={code}
          second={<TabLog />}
        />
      }
    />
  )
}

function TabLog() {
  const state = useAtomValue(activeLogAtom)
  const tabId = useAtomValue(activeTabIdAtom)
  const clear = useSetAtom(clearLogsAtom)
  const update = useSetAtom(updateLogViewAtom)
  const setState = (change: (current: LogView) => LogView) => {
    if (tabId === null) return
    update({ tabId, update: change })
  }
  return (
    <LogArea
      onClear={() => {
        if (tabId !== null) clear(tabId)
      }}
      state={state}
      onChange={setState}
      onCopy={copyText}
      onError={showError}
    />
  )
}

function EmptyPage() {
  const openQueryTab = useSetAtom(openQueryTabAtom)

  return (
    <div className="size-full flex flex-col items-center justify-center gap-4 select-none">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-xl border bg-muted/30 p-4 text-muted-foreground/50">
          <FilePlus2 className="size-10 stroke-[1.25]" />
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">暂无打开的查询</p>
          <p className="text-xs text-muted-foreground">
            新建一个查询标签页以开始编写 SQL
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => openQueryTab()}
      >
        <FilePlus2 className="size-3.5" />
        新建查询
      </Button>

      <p className="text-[11px] text-muted-foreground/50 mt-1">
        也可以点击标签栏右侧的
        <kbd className="mx-1 inline-flex items-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
          +
        </kbd>
        按钮新建
      </p>
    </div>
  )
}
