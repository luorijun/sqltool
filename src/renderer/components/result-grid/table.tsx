import {
  type ColumnPinningState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  flexRender,
  functionalUpdate,
  type SortingState,
  type Updater,
  useTable,
} from "@tanstack/react-table"
import { ArrowDownAZ, ArrowUpAZ, RotateCcw } from "lucide-react"
import { type CSSProperties, type ReactNode, useMemo } from "react"
import { cn } from "tailwind-variants"
import type { QueryResultColumn } from "@/contracts/database"
import { Button } from "@/renderer/components/ui/button"
import { AreaStatusBar, AreaToolbar } from "@/renderer/components/ui/panel-bar"
import { EmptyState } from "./empty"
import { features } from "./features"
import {
  getQueryColumnHeaderTitle,
  getQueryColumnTypeLabel,
  getQueryValueDisplay,
  isQueryColumnRightAligned,
  serializeQueryValue,
} from "./format"
import { ColumnVisibilityMenu, CopyMenu, ExportMenu, HeaderMenu } from "./menus"
import {
  type ResultActions,
  type ResultColumn,
  type ResultColumnDef,
  type ResultLayout,
  type ResultTableInstance,
  type ResultTableState,
  ROW_NUMBER_COLUMN_ID,
} from "./types"

interface ResultTableBase extends ResultActions {
  tableState: ResultTableState
  onLayoutChange: (update: (current: ResultLayout) => ResultLayout) => void
  onReset: () => void
  busy?: boolean
  emptyMessage?: string
  exportNamePrefix?: string
  toolbarEnd?: ReactNode
  statusBarEnd?: ReactNode
}
type ResultTableProps = ResultTableBase &
  (
    | { readOnly: true; sorting?: never; onSortingChange?: never }
    | {
        readOnly: false
        sorting: SortingState
        onSortingChange: (sorting: SortingState) => void
      }
  )

export function ResultTable({
  onCopy,
  onExport,
  onError,
  tableState,
  onLayoutChange,
  onReset,
  readOnly,
  sorting,
  busy = false,
  onSortingChange,
  emptyMessage = "语句执行成功，但没有可展示的结果集",
  exportNamePrefix = "query-result",
  toolbarEnd,
  statusBarEnd,
}: ResultTableProps) {
  const enableSorting = !readOnly
  const columns = useMemo<ResultColumnDef[]>(
    () => [
      {
        id: ROW_NUMBER_COLUMN_ID,
        header: "#",
        size: ROW_NUMBER_COLUMN_WIDTH,
        minSize: ROW_NUMBER_COLUMN_WIDTH,
        maxSize: ROW_NUMBER_COLUMN_WIDTH,
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        enablePinning: true,
        cell: ({ row }) => row.index + 1,
      },
      ...tableState.columns.map<ResultColumnDef>((resultColumn) => {
        const typeLabel = getQueryColumnTypeLabel(resultColumn)
        const labelWidth = resultColumn.name.length + (typeLabel?.length ?? 0)

        return {
          id: resultColumn.id,
          header: resultColumn.name,
          accessorKey: resultColumn.id,
          size: Math.min(Math.max(labelWidth * 8 + 64, 160), 360),
          minSize: MIN_DATA_COLUMN_WIDTH,
          enableSorting,
          cell: ({ cell }) => (
            <CellValue value={cell.getValue()} column={resultColumn} />
          ),
        }
      }),
    ],
    [enableSorting, tableState.columns],
  )

  const columnMetaById = useMemo(
    () => new Map(tableState.columns.map((column) => [column.id, column])),
    [tableState.columns],
  )

  const state = useMemo(
    () => ({
      sorting: sorting ?? [],
      columnVisibility: tableState.visibility,
      columnSizing: tableState.sizing,
      columnPinning: normalizePinning(tableState.pinning),
    }),
    [sorting, tableState],
  )

  const table = useTable({
    features,
    data: tableState.data,
    columns,
    state,
    getRowId: (_, i) => String(i),
    enableSorting,
    sortDescFirst: false,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: true,
    columnResizeMode: "onEnd",
    defaultColumn: {
      size: 160,
      minSize: MIN_DATA_COLUMN_WIDTH,
    },
    onSortingChange: (updater: Updater<SortingState>) => {
      if (!enableSorting || busy) {
        return
      }
      if (!readOnly) onSortingChange(functionalUpdate(updater, sorting))
    },
    onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
      onLayoutChange((current) => ({
        ...current,
        visibility: functionalUpdate(updater, current.visibility),
      }))
    },
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) => {
      onLayoutChange((current) => ({
        ...current,
        sizing: functionalUpdate(updater, current.sizing),
      }))
    },
    onColumnPinningChange: (updater: Updater<ColumnPinningState>) => {
      onLayoutChange((current) => ({
        ...current,
        pinning: normalizePinning(functionalUpdate(updater, current.pinning)),
      }))
    },
  })

  const handleResetLayout = () => {
    onReset()
  }

  const handleCellClick = (rowId: string, columnId: string) => {
    onLayoutChange((current) => {
      if (
        current.selected?.rowId === rowId &&
        current.selected.colId === columnId
      ) {
        return current
      }

      return { ...current, selected: { rowId, colId: columnId } }
    })
  }

  const exportName = `${exportNamePrefix}-${tableState.dataAt ? new Date(tableState.dataAt).toISOString().slice(11, 19).replaceAll(":", "-") : "latest"}`
  const hasDataColumns = tableState.columns.length > 0
  const hasRows = table.getRowModel().rows.length > 0
  const visibleDataColumnCount = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID).length
  const sortingSummary = enableSorting ? getSortingSummary(table) : null
  const statusText = !hasDataColumns
    ? "语句执行成功，但没有可展示的结果集"
    : hasRows
      ? null
      : "当前结果集为空"

  return (
    <div className="size-full flex flex-col overflow-hidden">
      <AreaToolbar>
        <ColumnVisibilityMenu
          table={table}
          dataColumnCount={tableState.columns.length}
          disabled={!hasDataColumns}
        />
        <CopyMenu
          onCopy={onCopy}
          onError={onError}
          table={table}
          activeCell={tableState.selected}
          disabled={!hasDataColumns}
        />
        <ExportMenu
          onExport={onExport}
          table={table}
          defaultName={exportName}
          disabled={!hasDataColumns}
        />
        <div className="ml-auto" />
        {toolbarEnd}
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          onClick={handleResetLayout}
          title="重置表格布局"
        >
          <RotateCcw className="size-3" />
          重置布局
        </Button>
      </AreaToolbar>

      <AreaStatusBar className="px-3 text-[11px]">
        <span>
          <span className="text-foreground font-medium">
            {tableState.data.length}
          </span>{" "}
          行
        </span>
        <span>
          <span className="text-foreground font-medium">
            {tableState.columns.length}
          </span>{" "}
          列
        </span>
        {sortingSummary && <span>当前排序: {sortingSummary}</span>}
        {statusText && <span>{statusText}</span>}
        {statusBarEnd}
      </AreaStatusBar>

      <div className="flex-1 min-h-0 overflow-auto bg-background">
        {!hasDataColumns ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <table
            className="table-fixed border-separate border-spacing-0 text-sm"
            style={{ width: `${table.getTotalSize()}px`, minWidth: "100%" }}
          >
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const column = header.column
                    const serial = column.id === ROW_NUMBER_COLUMN_ID
                    const sorted = column.getIsSorted()
                    const pinned = column.getIsPinned()
                    const Trigger = column.getCanSort() ? "button" : "div"
                    const resultColumn = serial
                      ? undefined
                      : columnMetaById.get(column.id)

                    return (
                      <th
                        key={header.id}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
                        title={
                          resultColumn
                            ? getQueryColumnHeaderTitle(resultColumn)
                            : undefined
                        }
                        className={cn(
                          "group sticky top-0 z-10 h-8 px-2 text-xs font-mono border-b border-r last:border-r-0 bg-sidebar",
                          pinned && "z-20",
                          serial && "text-muted-foreground",
                        )}
                        style={{
                          ...getPinnedStyles(column),
                          width: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="flex items-center gap-1 min-w-0">
                            <Trigger
                              type={column.getCanSort() ? "button" : undefined}
                              disabled={column.getCanSort() ? busy : undefined}
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-1 text-left rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
                                column.getCanSort() &&
                                  !busy &&
                                  "cursor-pointer",
                              )}
                              onClick={() =>
                                column.getCanSort() &&
                                !busy &&
                                column.toggleSorting()
                              }
                              title={
                                resultColumn
                                  ? column.getCanSort()
                                    ? `${getQueryColumnHeaderTitle(resultColumn)}\n点击排序`
                                    : getQueryColumnHeaderTitle(resultColumn)
                                  : column.getCanSort()
                                    ? "点击排序"
                                    : undefined
                              }
                            >
                              {resultColumn ? (
                                <ColumnHeader column={resultColumn} />
                              ) : (
                                <span className="truncate">
                                  {flexRender(
                                    header.column.columnDef.header,
                                    header.getContext(),
                                  )}
                                </span>
                              )}
                              {!serial && sorted === "asc" && (
                                <ArrowUpAZ className="size-3 shrink-0 text-primary" />
                              )}
                              {!serial && sorted === "desc" && (
                                <ArrowDownAZ className="size-3 shrink-0 text-primary" />
                              )}
                            </Trigger>

                            {!serial && (
                              <HeaderMenu
                                column={column}
                                columnMeta={resultColumn}
                                busy={busy}
                                disableHide={visibleDataColumnCount <= 1}
                              />
                            )}
                          </div>
                        )}

                        {column.getCanResize() && !serial && (
                          <button
                            type="button"
                            aria-label={`调整 ${String(column.columnDef.header ?? column.id)} 列宽`}
                            className={cn(
                              "absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none touch-none",
                              column.getIsResizing() && "bg-primary/30",
                            )}
                            onDoubleClick={() => column.resetSize()}
                            onMouseDown={header.getResizeHandler()}
                            tabIndex={-1}
                          />
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {hasRows ? (
                table.getRowModel().rows.map((row) => {
                  const isActiveRow = tableState.selected?.rowId === row.id

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "group cursor-default transition-colors hover:bg-accent/40",
                        isActiveRow && "bg-accent/20",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const column = cell.column
                        const serial = column.id === ROW_NUMBER_COLUMN_ID
                        const isActiveCell =
                          tableState.selected?.rowId === row.id &&
                          tableState.selected.colId === column.id
                        const resultColumn = serial
                          ? undefined
                          : columnMetaById.get(column.id)
                        const rawValue = cell.getValue()
                        const display = getQueryValueDisplay(
                          rawValue,
                          resultColumn,
                        )
                        const alignRight = resultColumn
                          ? isQueryColumnRightAligned(resultColumn)
                          : display.kind === "number"
                        const pinned = column.getIsPinned()
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "h-8 px-2 font-mono border-b border-r last:border-r-0 bg-background group-hover:bg-accent/40",
                              pinned && "sticky z-10",
                              serial && "text-right text-muted-foreground",
                              isActiveRow && "bg-accent/20",
                              alignRight && "text-right",
                              isActiveCell &&
                                "bg-primary/10 ring-1 ring-inset ring-primary/25",
                            )}
                            style={{
                              ...getPinnedStyles(column),
                              width: column.getSize(),
                            }}
                          >
                            {serial ? (
                              flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )
                            ) : (
                              <button
                                type="button"
                                className={cn(
                                  "block w-full min-w-0 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
                                  alignRight ? "text-right" : "text-left",
                                )}
                                onClick={() =>
                                  handleCellClick(row.id, column.id)
                                }
                                title={serializeQueryValue(
                                  rawValue,
                                  resultColumn,
                                )}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td
                    colSpan={table.getVisibleLeafColumns().length}
                    className="px-4 py-10 text-center text-xs text-muted-foreground"
                  >
                    结果集为空
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ColumnHeader({ column }: { column: QueryResultColumn }) {
  const typeLabel = getQueryColumnTypeLabel(column)

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate leading-4 shrink-0 max-w-full">
        {column.name}
      </span>
      {typeLabel && (
        <span className="truncate text-[10px] font-normal leading-4 text-muted-foreground">
          {typeLabel}
        </span>
      )}
    </span>
  )
}

function CellValue({
  value,
  column,
}: {
  value: unknown
  column?: QueryResultColumn
}) {
  const display = getQueryValueDisplay(value, column)

  if (display.kind === "null") {
    return (
      <span className="font-mono text-xs italic text-muted-foreground/75">
        {display.text}
      </span>
    )
  }

  if (display.kind === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-none",
          display.text === "true"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
        title={display.text}
      >
        {display.text}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "block truncate font-mono text-xs",
        (display.kind === "json" || display.kind === "binary") &&
          "text-muted-foreground",
      )}
      title={display.text}
    >
      {display.text || "\u00a0"}
    </span>
  )
}

const MIN_DATA_COLUMN_WIDTH = 96
const ROW_NUMBER_COLUMN_WIDTH = 52

function getSortLabel(column: ResultColumn): string {
  const sorted = column.getIsSorted()
  if (sorted === "asc") {
    return "升序"
  }

  if (sorted === "desc") {
    return "降序"
  }

  return "未排序"
}

function getPinnedStyles(column: ResultColumn): CSSProperties {
  const pinned = column.getIsPinned()
  if (pinned === "start") {
    return {
      insetInlineStart: `${column.getStart("start")}px`,
    }
  }
  if (pinned === "end") {
    return {
      insetInlineEnd: `${column.getAfter("end")}px`,
    }
  }
  return {}
}

export function normalizePinning(
  pinning: ColumnPinningState,
): ColumnPinningState {
  const start = [...new Set([ROW_NUMBER_COLUMN_ID, ...pinning.start])]
  const startIds = new Set(start)
  const end = [...new Set(pinning.end.filter((id) => !startIds.has(id)))]
  return { start, end }
}

function getSortingSummary(table: ResultTableInstance): string | null {
  const sorting = table.state.sorting[0]
  if (!sorting) {
    return null
  }

  const column = table
    .getAllLeafColumns()
    .find((item) => item.id === sorting.id && item.id !== ROW_NUMBER_COLUMN_ID)

  if (!column) {
    return null
  }

  return `${String(column.columnDef.header ?? column.id)} ${getSortLabel(column)}`
}
