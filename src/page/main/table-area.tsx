import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

// ─── Mock Data ────────────────────────────────────────────────────────────────

const columns = [
  "id",
  "username",
  "email",
  "role",
  "status",
  "created_at",
  "updated_at",
]

const rows = Array.from({ length: 32 }, (_, i) => ({
  id: i + 1,
  username: `user_${String(i + 1).padStart(3, "0")}`,
  email: `user${i + 1}@example.com`,
  role: i % 7 === 0 ? "admin" : i % 4 === 0 ? "moderator" : "member",
  status: i % 9 === 0 ? "inactive" : "active",
  created_at: new Date(Date.now() - i * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " "),
  updated_at: new Date(Date.now() - i * 3_600_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " "),
}))

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

// ─── Component ────────────────────────────────────────────────────────────────

export function TableArea() {
  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex-none flex items-center gap-4 px-3 h-7 border-b bg-muted/20 text-xs text-muted-foreground shrink-0">
        <span>
          <span className="text-foreground font-medium">{rows.length}</span> 行
        </span>
        <span>
          <span className="text-foreground font-medium">{columns.length}</span>{" "}
          列
        </span>
        <span className="ml-auto">耗时 12 ms</span>
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
                key={row.id}
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
                    <CellValue
                      col={col}
                      value={String(row[col as keyof typeof row])}
                    />
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
