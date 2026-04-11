import { CheckCircle2, CircleX, Info, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type LogStatus = "success" | "error" | "info" | "running"

interface LogEntry {
  id: string
  time: string
  status: LogStatus
  sql: string
  detail?: string
  duration?: number
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_LOGS: LogEntry[] = [
  {
    id: "5",
    time: "14:32:01",
    status: "running",
    sql: "SELECT * FROM orders WHERE status = 'pending'",
  },
  {
    id: "4",
    time: "14:31:45",
    status: "success",
    sql: "SELECT u.id, u.username, u.email FROM users u LIMIT 100",
    duration: 12,
    detail: "返回 100 行",
  },
  {
    id: "3",
    time: "14:31:22",
    status: "error",
    sql: "SELECT * FROM nonexistent_table",
    detail:
      'ERROR: relation "nonexistent_table" does not exist\nLINE 1: SELECT * FROM nonexistent_table',
  },
  {
    id: "2",
    time: "14:30:55",
    status: "success",
    sql: "UPDATE users SET role = 'admin' WHERE id = 1",
    duration: 5,
    detail: "1 行受影响",
  },
  {
    id: "1",
    time: "14:30:30",
    status: "info",
    sql: "已连接到 localhost:5432/mydb",
  },
]

// ─── Status Icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: LogStatus }) {
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

function StatusBadge({ status }: { status: LogStatus }) {
  const map: Record<LogStatus, { label: string; className: string }> = {
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
        >
          <Trash2 />
        </Button>
      </div>

      {/* Log list */}
      <ScrollArea className="flex-1">
        {MOCK_LOGS.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            暂无执行记录
          </p>
        ) : (
          <ul className="p-2 space-y-0.5">
            {MOCK_LOGS.map((entry) => (
              <LogEntryItem key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
