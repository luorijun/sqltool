import {
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type Updater,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table"
import { useAtom, useSetAtom } from "jotai"
import { ArrowDownAZ, ArrowUpAZ, RotateCcw } from "lucide-react"
import { type CSSProperties, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  compareQueryValues,
  getQueryValueDisplay,
  serializeQueryValue,
} from "@/lib/query-result"
import type { TabTableState } from "@/lib/tabs"
import {
  activeTabTableStateAtom,
  resetActiveTabTableStateAtom,
} from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { AreaStatusBar, AreaToolbar } from "../bars"
import { EmptyState } from "./empty"
import { ColumnVisibilityMenu, CopyMenu, ExportMenu, HeaderMenu } from "./menus"

export function ResultTable() {
  const [tableState, setTableState] = useAtom(activeTabTableStateAtom)
  const resetTabState = useSetAtom(resetActiveTabTableStateAtom)

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
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
      ...tableState.columns.map((column) => ({
        id: column.id,
        header: column.name,
        accessorKey: column.id,
        size: Math.min(Math.max(column.name.length * 16, 140), 280),
        minSize: MIN_DATA_COLUMN_WIDTH,
        sortingFn: (left, right, columnId) =>
          compareQueryValues(left.getValue(columnId), right.getValue(columnId)),
        cell: ({ getValue }) => <CellValue value={getValue()} />,
      })),
    ],
    [tableState.columns],
  )

  const state = useMemo(
    () => ({
      sorting: tableState.sorting as SortingState,
      columnVisibility: tableState.visibility as VisibilityState,
      columnSizing: tableState.sizing as ColumnSizingState,
      columnPinning: normalizeColumnPinning(
        tableState.pinning as ColumnPinningState,
      ) as ColumnPinningState,
    }),
    [tableState],
  )

  const table = useReactTable({
    data: tableState.data,
    columns,
    state,
    getRowId: (_, i) => String(i),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: false,
    enableSortingRemoval: true,
    columnResizeMode: "onEnd",
    defaultColumn: {
      size: 160,
      minSize: MIN_DATA_COLUMN_WIDTH,
    },
    onSortingChange: (updater: Updater<SortingState>) => {
      setTableState((current) => ({
        sorting: functionalUpdate(updater, current.sorting as SortingState),
      }))
    },
    onColumnVisibilityChange: (updater: Updater<VisibilityState>) => {
      setTableState((current) => ({
        visibility: functionalUpdate(
          updater,
          current.visibility as VisibilityState,
        ),
      }))
    },
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) => {
      setTableState((current) => ({
        sizing: functionalUpdate(updater, current.sizing as ColumnSizingState),
      }))
    },
    onColumnPinningChange: (updater: Updater<ColumnPinningState>) => {
      setTableState((current) => ({
        pinning: normalizeColumnPinning(
          functionalUpdate(updater, current.pinning as ColumnPinningState),
        ),
      }))
    },
  })

  const handleResetLayout = () => {
    resetTabState()
  }

  const handleCellClick = (rowId: string, columnId: string) => {
    setTableState((current) => {
      if (
        current.selected?.rowId === rowId &&
        current.selected.colId === columnId
      ) {
        return null
      }

      return { selected: { rowId, colId: columnId } }
    })
  }

  const exportName = `query-result-${tableState.dataAt ? new Date(tableState.dataAt).toISOString().slice(11, 19).replaceAll(":", "-") : "latest"}`
  const hasDataColumns = tableState.columns.length > 0
  const hasRows = table.getRowModel().rows.length > 0
  const visibleDataColumnCount = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID).length
  const sortingSummary = getSortingSummary(table)
  const statusText = !hasDataColumns
    ? "语句执行成功，但没有可展示的结果集"
    : hasRows
      ? "按当前视图复制或导出"
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
          table={table}
          activeCell={tableState.selected}
          disabled={!hasDataColumns}
        />
        <ExportMenu
          table={table}
          defaultName={exportName}
          disabled={!hasDataColumns}
        />
        <div className="ml-auto" />
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
        <span>当前排序: {sortingSummary}</span>
        <span>{statusText}</span>
        {!hasRows && tableState.columns.length > 0 && (
          <span>暂无可复制的当前单元格/行</span>
        )}
      </AreaStatusBar>

      <div className="flex-1 min-h-0 overflow-auto bg-background">
        {!hasDataColumns ? (
          <EmptyState message="语句执行成功，但没有可展示的结果集" />
        ) : (
          <table
            className="border-separate border-spacing-0 text-sm"
            style={{ width: `${table.getTotalSize()}px`, minWidth: "100%" }}
          >
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const column = header.column
                    const serial = column.id === ROW_NUMBER_COLUMN_ID
                    const sorted = column.getIsSorted()
                    const painned = column.getIsPinned()

                    return (
                      <th
                        key={header.id}
                        className={cn(
                          "group sticky top-0 z-10 h-8 px-2 text-xs font-mono tracking-wide border-b border-r last:border-r-0 bg-sidebar",
                          painned && "z-20",
                          serial && "text-muted-foreground",
                        )}
                        style={{
                          ...getPinnedStyles(column),
                          width: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="flex items-center gap-1 min-w-0">
                            <button
                              type="button"
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-1 text-left outline-none",
                                column.getCanSort() && "cursor-pointer",
                              )}
                              onClick={() =>
                                column.getCanSort() && column.toggleSorting()
                              }
                              title={
                                column.getCanSort() ? "点击排序" : undefined
                              }
                            >
                              <span className="truncate">
                                {flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                )}
                              </span>
                              {!serial && sorted === "asc" && (
                                <ArrowUpAZ className="size-3 shrink-0 text-primary" />
                              )}
                              {!serial && sorted === "desc" && (
                                <ArrowDownAZ className="size-3 shrink-0 text-primary" />
                              )}
                            </button>

                            {!serial && (
                              <HeaderMenu
                                column={column}
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
                        const rawValue = cell.getValue()
                        const display = getQueryValueDisplay(rawValue)
                        const pinned = column.getIsPinned()
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "h-8 px-2 font-mono border-b border-r last:border-r-0 bg-background group-hover:bg-accent/40",
                              pinned && "sticky z-10",
                              serial && "text-right text-muted-foreground",
                              isActiveRow && "bg-accent/20",
                              display.kind === "number" && "text-right",
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
                                  display.kind === "number"
                                    ? "text-right"
                                    : "text-left",
                                )}
                                onClick={() =>
                                  handleCellClick(row.id, column.id)
                                }
                                title={serializeQueryValue(rawValue)}
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

function CellValue({ value }: { value: unknown }) {
  const display = getQueryValueDisplay(value)

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
        display.kind === "json" && "text-muted-foreground",
      )}
      title={display.text}
    >
      {display.text || "\u00a0"}
    </span>
  )
}

export const ROW_NUMBER_COLUMN_ID = "__rownum__"
const MIN_DATA_COLUMN_WIDTH = 96
const ROW_NUMBER_COLUMN_WIDTH = 52

export type ResultRow = Record<string, unknown>

export type ResultTableInstance = ReturnType<typeof useReactTable<ResultRow>>

function getSortLabel(column: Column<ResultRow, unknown>): string {
  const sorted = column.getIsSorted()
  if (sorted === "asc") {
    return "升序"
  }

  if (sorted === "desc") {
    return "降序"
  }

  return "未排序"
}

function getPinnedStyles(column: Column<ResultRow, unknown>): CSSProperties {
  const pinned = column.getIsPinned()
  if (pinned === "left") {
    return {
      left: `${column.getStart("left")}px`,
    }
  }
  if (pinned === "right") {
    return {
      right: `${column.getAfter("right")}px`,
    }
  }
  return {}
}

function normalizeColumnPinning(
  pinning: ColumnPinningState,
): TabTableState["pinning"] {
  const left = Array.from(
    new Set([
      ROW_NUMBER_COLUMN_ID,
      ...(pinning.left ?? []).filter((id) => id !== ROW_NUMBER_COLUMN_ID),
    ]),
  )
  const leftIds = new Set(left)
  const right = Array.from(
    new Set(
      (pinning.right ?? []).filter(
        (id) => id !== ROW_NUMBER_COLUMN_ID && !leftIds.has(id),
      ),
    ),
  )

  return { left, right }
}

function getSortingSummary(table: ResultTableInstance): string {
  const sorting = table.getState().sorting[0]
  if (!sorting) {
    return "未排序"
  }

  const column = table
    .getAllLeafColumns()
    .find((item) => item.id === sorting.id && item.id !== ROW_NUMBER_COLUMN_ID)

  if (!column) {
    return "未排序"
  }

  return `${String(column.columnDef.header ?? column.id)} ${getSortLabel(column)}`
}
