import { useAtomValue, useSetAtom } from "jotai"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  Copy,
  Filter,
  Loader2,
  Search,
  Trash2,
} from "lucide-react"
import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import serializeApi from "@/lib/serialize/renderer"
import type { TabLogEntry as LogEntry, TabLogStatus } from "@/lib/tabs"
import {
  activeTabLogEntriesAtom,
  activeTabLogViewAtom,
} from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { AreaStatusBar, AreaToolbar } from "./bars"

const STICKY_BOTTOM_OFFSET = 24
const TAB_LOG_STATUSES: TabLogStatus[] = ["success", "error", "running"]

const STATUS_META: Record<
  TabLogStatus,
  {
    label: string
    badgeClassName: string
    iconClassName: string
  }
> = {
  success: {
    label: "成功",
    badgeClassName: "bg-green-500/10 text-green-600 dark:text-green-400",
    iconClassName: "text-green-500",
  },
  error: {
    label: "失败",
    badgeClassName: "bg-destructive/10 text-destructive",
    iconClassName: "text-destructive",
  },
  running: {
    label: "执行中",
    badgeClassName: "bg-primary/10 text-primary",
    iconClassName: "text-primary",
  },
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)

  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":")
}

function getEntryDisplayTime(entry: LogEntry): string {
  return formatTime(entry.finishedAt ?? entry.startedAt)
}

function isNearBottom(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    STICKY_BOTTOM_OFFSET
  )
}

function serializeLogEntry(entry: LogEntry): string {
  const parts = [
    `[${STATUS_META[entry.status].label}] ${getEntryDisplayTime(entry)}${entry.durationMs !== undefined ? ` | ${entry.durationMs} ms` : ""}`,
    entry.summary,
    `SQL:\n${entry.sql}`,
  ]

  if (entry.detail) {
    parts.push(`详情:\n${entry.detail}`)
  }

  return parts.join("\n")
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex size-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}

function StatusIcon({ status }: { status: LogEntry["status"] }) {
  switch (status) {
    case "success":
      return (
        <CheckCircle2
          className={cn("size-3.5 shrink-0", STATUS_META[status].iconClassName)}
        />
      )
    case "error":
      return (
        <CircleX
          className={cn("size-3.5 shrink-0", STATUS_META[status].iconClassName)}
        />
      )
    case "running":
      return (
        <Loader2
          className={cn(
            "size-3.5 shrink-0 animate-spin",
            STATUS_META[status].iconClassName,
          )}
        />
      )
  }
}

function StatusBadge({ status }: { status: LogEntry["status"] }) {
  const { label, badgeClassName } = STATUS_META[status]

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-none",
        badgeClassName,
      )}
    >
      {label}
    </span>
  )
}

function StatusFilterMenu({
  selected,
  onToggle,
  onClear,
}: {
  selected: TabLogStatus[]
  onToggle: (status: TabLogStatus) => void
  onClear: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={selected.length > 0 ? "secondary" : "ghost"}
            size="icon-xs"
            className="text-muted-foreground"
            title="按状态过滤日志"
          />
        }
      >
        <Filter className="size-3.5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" className="min-w-44">
        <DropdownMenuItem onClick={onClear}>全部状态</DropdownMenuItem>
        <DropdownMenuSeparator />

        {TAB_LOG_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={selected.includes(status)}
            closeOnClick={false}
            onCheckedChange={() => onToggle(status)}
          >
            {STATUS_META[status].label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LogEntryItem({
  entry,
  expanded,
  onToggleExpand,
  onCopy,
}: {
  entry: LogEntry
  expanded: boolean
  onToggleExpand: () => void
  onCopy: () => void
}) {
  return (
    <li
      className={cn(
        "rounded-lg border px-2.5 py-2 text-xs transition-colors",
        entry.status === "error" && "border-destructive/20 bg-destructive/5",
        entry.status === "running" && "border-primary/20 bg-primary/5",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="pt-0.5">
          <StatusIcon status={entry.status} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
            <StatusBadge status={entry.status} />
            <span>{getEntryDisplayTime(entry)}</span>
            {entry.durationMs !== undefined && (
              <span>{entry.durationMs} ms</span>
            )}
          </div>

          <p
            className={cn(
              "mt-1 break-all text-xs font-medium",
              entry.status === "running" ? "text-primary" : "text-foreground",
            )}
          >
            {entry.summary}
          </p>

          <p
            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            title={entry.sql}
          >
            {entry.sql}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            title="复制该条日志"
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            title={expanded ? "收起详情" : "展开详情"}
            onClick={onToggleExpand}
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div>
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              SQL
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground">
              {entry.sql}
            </pre>
          </div>

          {entry.detail && (
            <div>
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                详情
              </p>
              <pre
                className={cn(
                  "mt-1 whitespace-pre-wrap break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px]",
                  entry.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {entry.detail}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function LogArea() {
  const entries = useAtomValue(activeTabLogEntriesAtom)
  const logUi = useAtomValue(activeTabLogViewAtom)
  const clearLogs = useSetAtom(activeTabLogEntriesAtom)
  const updateLogUi = useSetAtom(activeTabLogViewAtom)
  const [expandedEntryIds, setExpandedEntryIds] = useState<
    Record<string, boolean>
  >({})
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)

  const filteredEntries = useMemo(() => {
    if (!logUi) {
      return entries
    }

    const query = logUi.query.trim().toLocaleLowerCase()
    const hasStatusFilter = logUi.statuses.length > 0

    return entries.filter((entry) => {
      if (hasStatusFilter && !logUi.statuses.includes(entry.status)) {
        return false
      }

      if (!query) {
        return true
      }

      const haystack = `${entry.sql}\n${entry.summary}\n${entry.detail ?? ""}`
      return haystack.toLocaleLowerCase().includes(query)
    })
  }, [entries, logUi])

  const counts = useMemo(
    () => ({
      total: entries.length,
      filtered: filteredEntries.length,
      success: entries.filter((entry) => entry.status === "success").length,
      error: entries.filter((entry) => entry.status === "error").length,
      running: entries.filter((entry) => entry.status === "running").length,
    }),
    [entries, filteredEntries.length],
  )
  const lastVisibleEntry = filteredEntries.at(-1)

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
  }, [])

  useEffect(() => {
    if (
      !lastVisibleEntry ||
      !logUi?.followTail ||
      !shouldStickToBottomRef.current
    ) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [lastVisibleEntry, logUi?.followTail, scrollToBottom])

  useEffect(() => {
    if (!logUi?.followTail) {
      return
    }

    shouldStickToBottomRef.current = true
    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [logUi?.followTail, scrollToBottom])

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await serializeApi.writeClipboardText(text)
      toast.success(successMessage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败")
    }
  }

  if (!logUi) {
    return <div className="size-full" />
  }

  const handleToggleStatus = (status: TabLogStatus) => {
    updateLogUi((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }))
  }

  const handleToggleExpand = (entryId: string) => {
    setExpandedEntryIds((current) => ({
      ...current,
      [entryId]: !current[entryId],
    }))
  }

  const handleViewportScroll = (event: UIEvent<HTMLDivElement>) => {
    shouldStickToBottomRef.current = isNearBottom(event.currentTarget)
  }

  const handleCopyFiltered = async () => {
    if (filteredEntries.length === 0) {
      toast.error("当前没有可复制的日志")
      return
    }

    await handleCopy(
      filteredEntries.map((entry) => serializeLogEntry(entry)).join("\n\n"),
      "当前视图日志已复制",
    )
  }

  return (
    <div className="size-full flex flex-col overflow-hidden">
      <AreaToolbar>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={logUi.query}
            onChange={(event) => updateLogUi({ query: event.target.value })}
            className="h-7 rounded-md pr-2 pl-7 text-xs"
            placeholder="搜索 SQL / 摘要 / 详情"
            aria-label="搜索日志"
          />
        </div>

        <StatusFilterMenu
          selected={logUi.statuses}
          onToggle={handleToggleStatus}
          onClear={() => updateLogUi({ statuses: [] })}
        />

        <Button
          variant={logUi.followTail ? "secondary" : "ghost"}
          size="icon-xs"
          className="text-muted-foreground"
          title={
            logUi.followTail ? "已开启自动跟随最新日志" : "开启自动跟随最新日志"
          }
          onClick={() => updateLogUi({ followTail: !logUi.followTail })}
        >
          <ChevronDown className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          title="复制当前视图日志"
          className="text-muted-foreground"
          onClick={() => void handleCopyFiltered()}
          disabled={filteredEntries.length === 0}
        >
          <Copy className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          title="清空日志"
          className="text-muted-foreground"
          onClick={() => clearLogs([])}
          disabled={entries.length === 0}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </AreaToolbar>

      <AreaStatusBar>
        <span>{counts.total} 条</span>
        <span>当前 {counts.filtered} 条</span>
        <span>成功 {counts.success}</span>
        <span>失败 {counts.error}</span>
        <span>运行中 {counts.running}</span>
      </AreaStatusBar>

      <ScrollArea
        className="flex-1 min-h-0"
        viewportRef={viewportRef}
        viewportProps={{ onScroll: handleViewportScroll }}
      >
        {entries.length === 0 ? (
          <EmptyState message="暂无执行记录" />
        ) : filteredEntries.length === 0 ? (
          <EmptyState message="没有符合当前筛选条件的日志" />
        ) : (
          <ul className="space-y-2 p-2">
            {filteredEntries.map((entry) => (
              <LogEntryItem
                key={entry.id}
                entry={entry}
                expanded={Boolean(expandedEntryIds[entry.id])}
                onToggleExpand={() => handleToggleExpand(entry.id)}
                onCopy={() =>
                  void handleCopy(
                    serializeLogEntry(entry),
                    "日志已复制到剪贴板",
                  )
                }
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
