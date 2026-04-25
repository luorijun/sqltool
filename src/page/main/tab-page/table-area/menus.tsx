import type { Column } from "@tanstack/react-table"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Columns3,
  Copy,
  Download,
  EyeOff,
  Pin,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  serializeMatrixAsDelimitedText,
  serializeQueryValue,
  serializeValuesAsDelimitedText,
} from "@/lib/query-result"
import serializeApi from "@/lib/serialize/renderer"
import type { TabTableState } from "@/lib/tabs"
import {
  type ResultRow,
  type ResultTableInstance,
  ROW_NUMBER_COLUMN_ID,
} from "./table"

interface ExportPayload {
  headers: string[]
  rows: unknown[][]
}

type ExportFormat = "csv" | "tsv"

function buildExportPayload(table: ResultTableInstance): ExportPayload {
  const exportColumns = table
    .getVisibleLeafColumns()
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

function toDelimitedText(payload: ExportPayload, format: ExportFormat): string {
  return serializeMatrixAsDelimitedText(
    payload.headers,
    payload.rows,
    format === "csv" ? "," : "\t",
  )
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

export function CopyMenu({
  table,
  activeCell,
  disabled,
}: {
  table: ResultTableInstance
  activeCell: TabTableState["activeCell"]
  disabled?: boolean
}) {
  const activeRow = activeCell
    ? table.getRowModel().rowsById[activeCell.rowId]
    : undefined
  const activeColumn = activeCell
    ? table
        .getAllLeafColumns()
        .find((column) => column.id === activeCell.columnId)
    : undefined

  const handleCopy = async (mode: "cell" | "row" | "result") => {
    let text = ""

    if (mode === "cell") {
      if (!activeRow || !activeColumn) {
        toast.error("请先选中一个单元格")
        return
      }

      text = serializeQueryValue(activeRow.getValue(activeColumn.id))
    } else if (mode === "row") {
      if (!activeRow) {
        toast.error("请先选中一行")
        return
      }

      text = serializeValuesAsDelimitedText(
        activeRow
          .getVisibleCells()
          .filter((cell) => cell.column.id !== ROW_NUMBER_COLUMN_ID)
          .map((cell) => cell.getValue()),
      )
    } else {
      text = toDelimitedText(buildExportPayload(table), "tsv")
    }

    try {
      await serializeApi.writeClipboardText(text)
      toast.success(mode === "result" ? "结果集已复制" : "已复制到剪贴板")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败")
    }
  }

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="gap-1.5 text-muted-foreground"
        disabled
      >
        <Copy className="size-3" />
        复制
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
        <Copy className="size-3" />
        复制
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onClick={() => handleCopy("cell")}>
          复制当前单元格
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopy("row")}>
          复制当前行
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleCopy("result")}>
          复制当前结果集
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ExportMenu({
  table,
  defaultName,
  disabled,
}: {
  table: ResultTableInstance
  defaultName: string
  disabled?: boolean
}) {
  const handleExport = async (format: ExportFormat) => {
    const payload = buildExportPayload(table)
    const content = toDelimitedText(payload, format)

    try {
      const savedPath = await serializeApi.saveTextFile({
        defaultPath: `${defaultName}.${format}`,
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format],
          },
        ],
        content,
      })

      if (savedPath) {
        toast.success(`已导出到 ${savedPath}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败")
    }
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
        导出
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
        导出
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
  disableHide,
}: {
  column: Column<ResultRow, unknown>
  disableHide: boolean
}) {
  if (column.id === ROW_NUMBER_COLUMN_ID) {
    return null
  }

  return (
    <DropdownMenu>
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

      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {String(column.columnDef.header ?? column.id)}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
            <ArrowUpAZ className="size-3.5" />
            升序
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
            <ArrowDownAZ className="size-3.5" />
            降序
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.clearSorting()}>
            <RotateCcw className="size-3.5" />
            清除排序
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() =>
              column.pin(column.getIsPinned() === "left" ? false : "left")
            }
          >
            <Pin className="size-3.5" />
            {column.getIsPinned() === "left" ? "取消固定" : "固定到左侧"}
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
