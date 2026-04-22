import { useAtomValue } from "jotai"
import type { ReactNode } from "react"
import { CircleX, Loader2, Table2 } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { activeTabContentAtom } from "@/lib/tabs"
import { cn } from "@/lib/utils"

// ─── Cell Formatting ──────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  admin: "text-amber-600 dark:text-amber-400 font-medium",
  moderator: "text-blue-600 dark:text-blue-400 font-medium",
  member: "",
}

const STATUS_STYLES: Record<string, string> = {
  active: "text-green-600 dark:text-green-400",
  inactive: "text-muted-foreground line-through",
}

function formatCellValue(value: unknown): string {
  if (value === null) return "NULL"
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }

  return JSON.stringify(value)
}

function CellValue({ col, value }: { col: string; value: unknown }) {
  const text = formatCellValue(value)

  if (col === "role") {
    return (
      <span className={cn("font-mono text-xs", ROLE_STYLES[text] ?? "")}>
        {text}
      </span>
    )
  }
  if (col === "status") {
    return (
      <span className={cn("font-mono text-xs", STATUS_STYLES[text] ?? "")}>
        {text}
      </span>
    )
  }
  return <span className="font-mono text-xs">{text}</span>
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-2 text-center select-none">
      {icon ?? <Table2 className="size-8 text-muted-foreground/25 stroke-[1.25]" />}
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TableArea() {
  const content = useAtomValue(activeTabContentAtom)

  if (!content) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (content.running) {
    return (
      <EmptyState
        icon={<Loader2 className="size-8 text-primary/40 animate-spin" />}
        message="正在执行 SQL..."
      />
    )
  }

  if (content.error) {
    return (
      <EmptyState
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={content.error}
      />
    )
  }

  if (!content.executed) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (content.columns.length === 0) {
    return <EmptyState message="语句执行成功，但没有可展示的结果集" />
  }

  const columns = content.columns
  const rows = content.rows

  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex-none flex items-center gap-4 px-3 h-7 border-b bg-muted/20 text-xs text-muted-foreground shrink-0">
        <span>
          <span className="text-foreground font-medium">{content.rowCount}</span>{" "}
          行
        </span>
        <span>
          <span className="text-foreground font-medium">
            {content.columns.length}
          </span>{" "}
          列
        </span>
        <span className="ml-auto">耗时 {content.durationMs} ms</span>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 min-h-0">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead>
            <tr className="sticky top-0 z-10 bg-sidebar shadow-[0_1px_0_0_hsl(var(--border))]">
              {/* Row-number gutter */}
              <th className="w-10 px-2 py-1.5 text-right text-xs font-mono font-normal text-muted-foreground border-b border-r select-none">
                #
              </th>

              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-1.5 text-left text-xs font-semibold tracking-wide border-b border-r whitespace-nowrap last:border-r-0"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="group hover:bg-accent/50 cursor-default transition-colors"
              >
                {/* Row number */}
                <td className="px-2 py-1 text-right text-xs font-mono text-muted-foreground border-b border-r select-none group-hover:text-foreground/60 transition-colors">
                  {ri + 1}
                </td>

                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1 border-b border-r whitespace-nowrap last:border-r-0"
                  >
                    <CellValue col={col} value={row[col]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  )
}
