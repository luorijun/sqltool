import { useAtomValue, useSetAtom } from "jotai"
import { CheckCircle2, CircleX, Info, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  activeTabContentAtom,
  clearActiveTabLogsAtom,
  type TabLogEntry as LogEntry,
} from "@/lib/tabs"
import { cn } from "@/lib/utils"

// ─── Status Icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: LogEntry["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
    case "error":
      return <CircleX className="size-3.5 shrink-0 text-destructive" />
    case "running":
      return <Loader2 className="size-3.5 shrink-0 text-primary animate-spin" />
    default:
      return <Info className="size-3.5 shrink-0 text-muted-foreground" />
  }
}

// ─── Status Label ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LogEntry["status"] }) {
  const map: Record<LogEntry["status"], { label: string; className: string }> = {
    success: {
      label: "成功",
      className: "bg-green-500/10 text-green-600 dark:text-green-400",
    },
    error: {
      label: "失败",
      className: "bg-destructive/10 text-destructive",
    },
    running: {
      label: "执行中",
      className: "bg-primary/10 text-primary",
    },
    info: {
      label: "信息",
      className: "bg-muted text-muted-foreground",
    },
  }

  const { label, className: cls } = map[status]

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-none",
        cls,
      )}
    >
      {label}
    </span>
  )
}

// ─── Log Entry Item ───────────────────────────────────────────────────────────

function LogEntryItem({ entry }: { entry: LogEntry }) {
  return (
    <li
      className={cn(
        "rounded-md px-2 py-2 text-xs font-mono transition-colors cursor-default",
        "hover:bg-accent/60",
        entry.status === "error" && "bg-destructive/5 hover:bg-destructive/10",
        entry.status === "running" && "bg-primary/5",
      )}
    >
      {/* Top row: icon + status + time + duration */}
      <div className="flex items-center gap-1.5 mb-1">
        <StatusIcon status={entry.status} />
        <StatusBadge status={entry.status} />
        <span className="text-muted-foreground">{entry.time}</span>
        {entry.duration !== undefined && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">{entry.duration} ms</span>
          </>
        )}
      </div>

      {/* SQL statement */}
      <p
        className={cn(
          "truncate pl-5",
          entry.status === "running" ? "text-primary" : "text-foreground",
        )}
        title={entry.sql}
      >
        {entry.sql}
      </p>

      {/* Detail message */}
      {entry.detail && (
        <p
          className={cn(
            "pl-5 mt-0.5 whitespace-pre-wrap break-all",
            entry.status === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {entry.detail}
        </p>
      )}
    </li>
  )
}

// ─── Exec Log ─────────────────────────────────────────────────────────────────

export function ExecLog() {
  const content = useAtomValue(activeTabContentAtom)
  const clearLogs = useSetAtom(clearActiveTabLogsAtom)
  const entries = content?.logs || []

  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-3 h-9 border-b bg-muted/20 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          执行日志
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          title="清空日志"
          className="text-muted-foreground"
          onClick={() => clearLogs()}
          disabled={entries.length === 0}
        >
          <Trash2 />
        </Button>
      </div>

      {/* Log list */}
      <ScrollArea className="flex-1">
        {entries.length > 0 ? (
          <ul className="p-2 space-y-0.5">
            {entries.map((entry) => (
              <LogEntryItem key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            暂无执行记录
          </p>
        )}
      </ScrollArea>
    </div>
  )
}
