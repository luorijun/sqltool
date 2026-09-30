import {
  ArrowDownAZ,
  Check,
  Columns3,
  Copy,
  Download,
  EyeOff,
  Pin,
} from "lucide-react"
import { useRef } from "react"
import type { QueryResultColumn } from "@/contracts/database"
import { Button } from "@/renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
import {
  getQueryColumnFlagLabels,
  getQueryColumnSourceLabel,
  getQueryColumnTypeLabel,
} from "./format"
import {
  type CopyOptions,
  serializeTable,
  type TablePayload,
} from "./serialize"
import type { ResultActions } from "./types"
import {
  type ResultColumn,
  type ResultTableInstance,
  ROW_NUMBER_COLUMN_ID,
} from "./types"

type ExportFormat = "csv" | "tsv"

export function buildExportPayload(table: ResultTableInstance): TablePayload {
  const exportColumns = (table.getHeaderGroups().at(-1)?.headers ?? [])
    .map((header) => header.column)
    .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID)

  return {
    headers: exportColumns.map((column) =>
      String(column.columnDef.header ?? ""),
    ),
    rows: table
      .getRowModel()
      .rows.map((row) =>
        exportColumns.map((column) => row.getValue(column.id)),
      ),
  }
}

export function ColumnVisibilityMenu({
  table,
  dataColumnCount,
  disabled,
}: {
  table: ResultTableInstance
  dataColumnCount: number
  disabled?: boolean
}) {
  const visibleDataColumnCount = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID).length

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="gap-1.5 text-muted-foreground"
        disabled
      >
        <Columns3 className="size-3" />列
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground"
          />
        }
      >
        <Columns3 className="size-3" />列
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>显示列</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {table
            .getAllLeafColumns()
            .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID)
            .map((column) => {
              const isOnlyVisible =
                column.getIsVisible() &&
                visibleDataColumnCount <= 1 &&
                dataColumnCount > 0

              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  closeOnClick={false}
                  disabled={isOnlyVisible}
                  onCheckedChange={(checked) =>
                    column.toggleVisibility(checked)
                  }
                >
                  {String(column.columnDef.header ?? column.id)}
                </DropdownMenuCheckboxItem>
              )
            })}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => table.toggleAllColumnsVisible(true)}>
            <Check className="size-3.5" />
            全部显示
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CopyFormatMenu({
  options,
  onChange,
  copyTarget,
}: {
  copyTarget: () => HTMLElement | null
  options: CopyOptions
  onChange: (options: CopyOptions) => void
}) {
  const changed = useRef(false)
  const change = (next: CopyOptions) => {
    changed.current = true
    onChange(next)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground"
          />
        }
      >
        <Copy className="size-3" />
        复制格式：{options.format.toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        finalFocus={() => {
          if (!changed.current) return true
          changed.current = false
          return copyTarget() ?? true
        }}
      >
        <DropdownMenuRadioGroup
          value={options.format}
          onValueChange={(format) => {
            if (format === "tsv" || format === "csv" || format === "json")
              change({ ...options, format })
          }}
        >
          <DropdownMenuRadioItem value="tsv">TSV</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="csv">CSV</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="json">JSON</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {options.format !== "json" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={options.headers}
              onCheckedChange={(headers) => change({ ...options, headers })}
            >
              包含列名
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ExportMenu({
  onExport,
  table,
  defaultName,
  disabled,
}: {
  table: ResultTableInstance
  defaultName: string
  disabled?: boolean
} & Pick<ResultActions, "onExport">) {
  const handleExport = async (format: ExportFormat) => {
    const payload = buildExportPayload(table)
    const content = serializeTable(payload, { format, headers: true })

    await onExport({
      defaultPath: `${defaultName}.${format}`,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [format],
        },
      ],
      content,
    })
  }

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="gap-1.5 text-muted-foreground"
        disabled
      >
        <Download className="size-3" />
        导出本页
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground"
          />
        }
      >
        <Download className="size-3" />
        导出本页
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")}>
          导出 CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("tsv")}>
          导出 TSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function HeaderMenu({
  column,
  columnMeta,
  disableHide,
  busy = false,
  onSort,
}: {
  column: ResultColumn
  columnMeta?: QueryResultColumn
  disableHide: boolean
  busy?: boolean
  onSort: () => void
}) {
  const openingSort = useRef(false)
  if (column.id === ROW_NUMBER_COLUMN_ID) {
    return null
  }

  const title = columnMeta?.name ?? String(column.columnDef.header ?? column.id)
  const typeLabel = getQueryColumnTypeLabel(columnMeta)
  const sourceLabel = getQueryColumnSourceLabel(columnMeta)
  const flags = getQueryColumnFlagLabels(columnMeta)
  const hasMetaDetails = Boolean(typeLabel || sourceLabel || flags.length)

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) openingSort.current = false
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            title="列操作"
          />
        }
      >
        <span className="text-[11px] leading-none">···</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="end"
        finalFocus={() => !openingSort.current}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="max-w-72">
            <span className="block truncate text-foreground">{title}</span>
            {hasMetaDetails && (
              <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] leading-4 text-muted-foreground/70">
                {typeLabel && <span>{typeLabel}</span>}
                {sourceLabel && <span>{sourceLabel}</span>}
                {flags.map((flag) => (
                  <span key={flag}>{flag}</span>
                ))}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {column.getCanSort() && (
            <>
              <DropdownMenuItem
                disabled={busy}
                onClick={() => {
                  openingSort.current = true
                  onSort()
                }}
              >
                <ArrowDownAZ className="size-3.5" />
                设置排序
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem
            onClick={() =>
              column.pin(column.getIsPinned() === "start" ? false : "start")
            }
          >
            <Pin className="size-3.5" />
            {column.getIsPinned() === "start" ? "取消固定" : "固定到左侧"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disableHide}
            onClick={() => column.toggleVisibility(false)}
          >
            <EyeOff className="size-3.5" />
            隐藏列
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
