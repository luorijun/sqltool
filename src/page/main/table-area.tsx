import { useAtomValue } from "jotai"
import { Table2 } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { activeTabContentAtom } from "@/lib/tabs"
import { cn } from "@/lib/utils"

// ─── Mock Row Generator ───────────────────────────────────────────────────────

function generateCellValue(col: string, i: number): string {
  if (col === "id") return String(i)
  if (col.endsWith("_id")) return String(((i * 7) % 99) + 1)
  if (col.endsWith("_at") || col.endsWith("_time"))
    return new Date(Date.now() - i * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ")
  if (col === "status") return i % 7 === 0 ? "inactive" : "active"
  if (col === "role")
    return i % 5 === 0 ? "admin" : i % 3 === 0 ? "moderator" : "member"
  if (col === "email") return `user${i}@example.com`
  if (col === "username") return `user_${String(i).padStart(3, "0")}`
  if (col.includes("price") || col.includes("total") || col.includes("amount"))
    return (((i * 1337) % 99000) / 100 + 10).toFixed(2)
  if (col === "quantity") return String(((i * 3) % 10) + 1)
  if (col === "stock") return String(((i * 17) % 500) + 1)
  if (col === "slug") return `item-${i}`
  if (col.includes("name")) return `Item ${i}`
  return `value_${i}`
}

function generateMockRows(columns: string[], count: number) {
  return Array.from({ length: count }, (_, i) => {
    const row: Record<string, string> = {}
    for (const col of columns) row[col] = generateCellValue(col, i + 1)
    return row
  })
}

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

function CellValue({ col, value }: { col: string; value: string }) {
  if (col === "role") {
    return (
      <span className={cn("font-mono text-xs", ROLE_STYLES[value] ?? "")}>
        {value}
      </span>
    )
  }
  if (col === "status") {
    return (
      <span className={cn("font-mono text-xs", STATUS_STYLES[value] ?? "")}>
        {value}
      </span>
    )
  }
  return <span className="font-mono text-xs">{value}</span>
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-2 text-center select-none">
      <Table2 className="size-8 text-muted-foreground/25 stroke-[1.25]" />
      <p className="text-xs text-muted-foreground">运行 SQL 语句以查看结果</p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TableArea() {
  const content = useAtomValue(activeTabContentAtom)

  if (!content || !content.executed || content.columns.length === 0) {
    return <EmptyState />
  }

  const columns = content.columns
  const rows = generateMockRows(columns, content.rowCount)

  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex-none flex items-center gap-4 px-3 h-7 border-b bg-muted/20 text-xs text-muted-foreground shrink-0">
        <span>
          <span className="text-foreground font-medium">
            {content.rowCount}
          </span>{" "}
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
