import type { ColumnDef } from "@tanstack/react-table"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useAtomValue } from "jotai"
import { CircleX, Loader2, Table2 } from "lucide-react"
import { useMemo } from "react"
import type { ReactNode } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import type { QueryResultRow } from "@/lib/conn"
import type { TabResultState } from "@/lib/tabs"
import { activeTabResultAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"

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

  try {
    const text = JSON.stringify(value)
    return text ?? String(value)
  } catch {
    return String(value)
  }
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

function EmptyState({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-2 text-center select-none">
      {icon ?? (
        <Table2 className="size-8 text-muted-foreground/25 stroke-[1.25]" />
      )}
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}

function StatusBar({ result }: { result: TabResultState }) {
  return (
    <div className="flex-none flex items-center gap-4 px-3 h-7 border-b bg-muted/20 text-xs text-muted-foreground shrink-0">
      <span>
        <span className="text-foreground font-medium">{result.rowCount}</span>{" "}
        行
      </span>
      <span>
        <span className="text-foreground font-medium">{result.columns.length}</span>{" "}
        列
      </span>
      <span className="ml-auto">耗时 {result.durationMs} ms</span>
    </div>
  )
}

function ResultTable({ result }: { result: TabResultState }) {
  const tableColumns = useMemo<ColumnDef<QueryResultRow>[]>(
    () => [
      {
        id: "__rownum__",
        header: "#",
        cell: ({ row }) => row.index + 1,
      },
      ...result.columns.map((column, columnIndex) => ({
        id: column.id,
        header: column.name,
        accessorFn: (row: QueryResultRow) => row[columnIndex],
        cell: ({ getValue }) => (
          <CellValue col={column.name} value={getValue()} />
        ),
      })),
    ],
    [result.columns],
  )

  const table = useReactTable({
    data: result.rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <ScrollArea className="flex-1 min-h-0">
      <table className="w-full text-sm border-collapse min-w-max">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, headerIndex) => {
                const isRowNumber = header.column.id === "__rownum__"

                return (
                  <th
                    key={header.id}
                    className={cn(
                      "sticky top-0 z-10 bg-sidebar shadow-[0_1px_0_0_hsl(var(--border))] border-b border-r whitespace-nowrap last:border-r-0",
                      isRowNumber
                        ? "w-10 px-2 py-1.5 text-right text-xs font-mono font-normal text-muted-foreground select-none"
                        : "px-3 py-1.5 text-left text-xs font-semibold tracking-wide",
                      headerIndex === headerGroup.headers.length - 1 &&
                        "border-r-0",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="group hover:bg-accent/50 cursor-default transition-colors"
            >
              {row.getVisibleCells().map((cell, cellIndex) => {
                const isRowNumber = cell.column.id === "__rownum__"

                return (
                  <td
                    key={cell.id}
                    className={cn(
                      "border-b border-r whitespace-nowrap last:border-r-0",
                      isRowNumber
                        ? "px-2 py-1 text-right text-xs font-mono text-muted-foreground select-none group-hover:text-foreground/60 transition-colors"
                        : "px-3 py-1",
                      cellIndex === row.getVisibleCells().length - 1 &&
                        "border-r-0",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  )
}

function ExecutedTableArea({ result }: { result: TabResultState }) {
  return (
    <div className="size-full flex flex-col overflow-hidden">
      <StatusBar result={result} />

      {result.columns.length === 0 ? (
        <EmptyState message="语句执行成功，但没有可展示的结果集" />
      ) : (
        <ResultTable result={result} />
      )}
    </div>
  )
}

export function TableArea() {
  const result = useAtomValue(activeTabResultAtom)

  if (!result) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (result.running) {
    return (
      <EmptyState
        icon={<Loader2 className="size-8 text-primary/40 animate-spin" />}
        message="正在执行 SQL..."
      />
    )
  }

  if (result.error) {
    return (
      <EmptyState
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={result.error}
      />
    )
  }

  if (!result.executed) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  return <ExecutedTableArea result={result} />
}
