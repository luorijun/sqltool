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
import {
  type CSSProperties,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react"
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
import {
  ColumnVisibilityMenu,
  CopyFormatMenu,
  ExportMenu,
  HeaderMenu,
} from "./menus"
import type { GridSelection } from "./selection"
import { type CopyOptions, selectionPayload, serializeTable } from "./serialize"
import { SortMenu } from "./sort-menu"
import {
  activeSorting,
  createSortDraft,
  type SortItem,
  sameSorting,
} from "./sorting"
import {
  type ResultActions,
  type ResultColumn,
  type ResultColumnDef,
  type ResultLayout,
  type ResultTableInstance,
  type ResultTableState,
  ROW_NUMBER_COLUMN_ID,
} from "./types"
import { useSelection } from "./use-selection"

interface ResultTableBase extends ResultActions {
  tableState: ResultTableState
  onLayoutChange: (update: (current: ResultLayout) => ResultLayout) => void
  onReset: () => void
  busy?: boolean
  emptyMessage?: string
  exportNamePrefix?: string
  toolbarActions?: ReactNode
  toolbarQuery?: ReactNode
  copyOptions: CopyOptions
  onCopyOptionsChange: (options: CopyOptions) => void
  onSelectionChange: (selection: GridSelection | null) => void
  statusBarStart?: ReactNode
  statusBarEnd?: ReactNode
}
type ResultTableProps = ResultTableBase &
  (
    | {
        readOnly: true
        sorting?: never
        sortOrder?: never
        onSortingChange?: never
      }
    | {
        readOnly: false
        sorting: SortingState
        sortOrder: string[]
        onSortingChange: (sorting: SortingState, order: string[]) => void
      }
  )

export function ResultTable({
  onExport,
  onError,
  tableState,
  onLayoutChange,
  onReset,
  readOnly,
  sorting,
  sortOrder,
  busy = false,
  onSortingChange,
  emptyMessage = "语句执行成功，但没有可展示的结果集",
  exportNamePrefix = "query-result",
  toolbarActions,
  toolbarQuery,
  copyOptions,
  onCopyOptionsChange,
  onSelectionChange,
  statusBarStart,
  statusBarEnd,
}: ResultTableProps) {
  const [sortDraft, setSortDraft] = useState<SortItem[] | null>(null)
  const [sortFocus, setSortFocus] = useState<string | null>(null)
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
    enableMultiSort: true,
    enableSortingRemoval: true,
    columnResizeMode: "onEnd",
    defaultColumn: {
      size: 160,
      minSize: MIN_DATA_COLUMN_WIDTH,
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

  const gridId = useId()
  const visibleColumns =
    table
      .getHeaderGroups()
      .at(-1)
      ?.headers.map((header) => header.column)
      .filter((column) => column.id !== ROW_NUMBER_COLUMN_ID) ?? []
  const columnIds = visibleColumns.map((column) => column.id)
  const selection = useSelection({
    selection: tableState.selection,
    onChange: onSelectionChange,
    data: tableState.data,
    columns: columnIds,
  })
  const selectedRows = new Set(selection.value?.rows)
  const selectedColumns = new Set(selection.value?.columns)
  const active = selection.value?.active
  const columnIndex = new Map(columnIds.map((id, index) => [id, index]))
  const cellId = (row: number, col: string) =>
    `${gridId}-${row}-${columnIndex.get(col)}`

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
      <AreaToolbar className="overflow-x-auto whitespace-nowrap">
        {toolbarActions}
        {!readOnly && (
          <>
            <SortMenu
              table={table}
              busy={busy}
              draft={sortDraft}
              order={sortOrder}
              focusColumn={sortFocus}
              onEdit={setSortDraft}
              onClose={(commit) => {
                const next = sortDraft
                setSortDraft(null)
                setSortFocus(null)
                if (!commit || !next || busy) return
                const applied = createSortDraft(
                  tableState.columns.map((column) => column.id),
                  sorting,
                  sortOrder,
                )
                const active = activeSorting(next)
                if (
                  !sameSorting(active, sorting) ||
                  next.some((item, index) => item.id !== applied[index]?.id)
                )
                  onSortingChange(
                    active,
                    next.map((item) => item.id),
                  )
              }}
            />
            {toolbarQuery}
          </>
        )}
        <div className="ml-auto" />
        <ColumnVisibilityMenu
          table={table}
          dataColumnCount={tableState.columns.length}
          disabled={!hasDataColumns}
        />
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          onClick={onReset}
          title="重置表格布局"
        >
          <RotateCcw className="size-3" />
          重置布局
        </Button>
        <CopyFormatMenu
          options={copyOptions}
          onChange={onCopyOptionsChange}
          copyTarget={() =>
            selection.ref.current?.querySelector<HTMLElement>("[role=grid]") ??
            null
          }
        />
        <ExportMenu
          onExport={onExport}
          table={table}
          defaultName={exportName}
          disabled={!hasDataColumns}
        />
      </AreaToolbar>

      <AreaStatusBar className="px-3 text-[11px]">
        {statusBarStart ?? (
          <span>共 {tableState.data.length.toLocaleString()} 行</span>
        )}
        {sortingSummary && <span>排序：{sortingSummary}</span>}
        <span className="h-3 w-px shrink-0 bg-border" />
        <span>
          {selectedRows.size > 0 && selectedColumns.size > 0
            ? `已选 ${selectedRows.size} 行 × ${selectedColumns.size} 列`
            : "未选择"}
        </span>
        {statusText && <span>{statusText}</span>}
        {statusBarEnd}
      </AreaStatusBar>

      <div
        ref={selection.ref}
        className="flex-1 min-h-0 overflow-auto bg-background select-none touch-none"
        {...selection.handlers}
        onCopy={(event) => {
          if (
            event.target !== event.currentTarget.querySelector("[role=grid]") ||
            !selection.value?.rows.length ||
            !selection.value.columns.length
          )
            return
          event.preventDefault()
          try {
            const columns = visibleColumns.flatMap((column) => {
              const meta = columnMetaById.get(column.id)
              return meta ? [meta] : []
            })
            event.clipboardData.setData(
              "text/plain",
              serializeTable(
                selectionPayload(tableState.data, columns, selection.value),
                copyOptions,
              ),
            )
          } catch (error) {
            onError(error instanceof Error ? error.message : "复制失败")
          }
        }}
      >
        {!hasDataColumns ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <table
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: This native table implements grid keyboard navigation and managed focus.
            role="grid"
            aria-label="查询结果"
            aria-multiselectable="true"
            aria-rowcount={tableState.data.length + 1}
            aria-colcount={visibleDataColumnCount + 1}
            aria-activedescendant={
              active ? cellId(active.row, active.col) : undefined
            }
            tabIndex={0}
            className="table-fixed border-separate border-spacing-0 text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40"
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
                    const resultColumn = serial
                      ? undefined
                      : columnMetaById.get(column.id)

                    return (
                      <th
                        key={header.id}
                        role="columnheader"
                        data-grid-row={-1}
                        data-grid-col={serial ? "" : column.id}
                        data-grid-pin={pinned || undefined}
                        aria-selected={
                          serial
                            ? selectedRows.size === tableState.data.length &&
                              selectedColumns.size === columnIds.length &&
                              hasRows
                            : selectedColumns.has(column.id) &&
                              selectedRows.size === tableState.data.length
                        }
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
                          selectedColumns.has(column.id) &&
                            "bg-accent text-primary",
                          selectedColumns.has(column.id) &&
                            selectedRows.size === tableState.data.length &&
                            "bg-[color-mix(in_oklab,var(--primary)_15%,var(--background))]",
                        )}
                        style={{
                          ...getPinnedStyles(column),
                          width: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="flex items-center gap-1 min-w-0">
                            <div className="flex min-w-0 flex-1 items-center gap-1 text-left cursor-default">
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
                            </div>

                            {!serial && (
                              <HeaderMenu
                                onSort={() => {
                                  setSortFocus(column.id)
                                  setSortDraft(
                                    createSortDraft(
                                      tableState.columns.map(
                                        (column) => column.id,
                                      ),
                                      sorting ?? [],
                                      sortOrder ?? [],
                                    ),
                                  )
                                }}
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
                  const isActiveRow = selectedRows.has(row.index)

                  return (
                    <tr key={row.id} className="group cursor-default">
                      {row.getVisibleCells().map((cell) => {
                        const column = cell.column
                        const serial = column.id === ROW_NUMBER_COLUMN_ID
                        const isActiveCell =
                          active?.row === row.index && active.col === column.id
                        const selected =
                          !serial &&
                          isActiveRow &&
                          selectedColumns.has(column.id)
                        const colIndex = columnIndex.get(column.id) ?? -1
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
                        const Cell = serial ? "th" : "td"
                        return (
                          <Cell
                            key={cell.id}
                            id={
                              serial ? undefined : cellId(row.index, column.id)
                            }
                            role={serial ? "rowheader" : "gridcell"}
                            data-grid-row={row.index}
                            data-grid-col={serial ? "" : column.id}
                            aria-selected={
                              serial
                                ? isActiveRow &&
                                  selectedColumns.size === columnIds.length
                                : selected
                            }
                            className={cn(
                              "h-8 px-2 font-mono border-b border-r last:border-r-0 bg-background",
                              pinned ? "sticky z-10" : "relative",
                              serial &&
                                "text-right font-normal text-muted-foreground",
                              !selected &&
                                "group-hover:bg-[color-mix(in_oklab,var(--accent)_40%,var(--background))]",
                              serial && isActiveRow && "bg-accent text-primary",
                              serial &&
                                isActiveRow &&
                                selectedColumns.size === columnIds.length &&
                                "bg-[color-mix(in_oklab,var(--primary)_15%,var(--background))]",
                              selected && "bg-accent",
                              alignRight && "text-right",
                              isActiveCell &&
                                "ring-2 ring-inset ring-primary/70",
                            )}
                            style={{
                              ...getPinnedStyles(column),
                              width: column.getSize(),
                            }}
                          >
                            {selected && (
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "pointer-events-none absolute inset-0 border-primary/40",
                                  !selectedRows.has(row.index - 1) &&
                                    "border-t",
                                  !selectedRows.has(row.index + 1) &&
                                    "border-b",
                                  !selectedColumns.has(
                                    columnIds[colIndex - 1],
                                  ) && "border-l",
                                  !selectedColumns.has(
                                    columnIds[colIndex + 1],
                                  ) && "border-r",
                                )}
                              />
                            )}
                            {serial ? (
                              flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )
                            ) : (
                              <div
                                className={cn(
                                  "block w-full min-w-0",
                                  alignRight ? "text-right" : "text-left",
                                )}
                                title={serializeQueryValue(
                                  rawValue,
                                  resultColumn,
                                )}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </div>
                            )}
                          </Cell>
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

function getSortingSummary(table: ResultTableInstance): string {
  return (
    table.state.sorting
      .map((order) => {
        const column = table
          .getAllLeafColumns()
          .find((column) => column.id === order.id)
        return `${String(column?.columnDef.header ?? order.id)}${order.desc ? "↓" : "↑"}`
      })
      .join(" ") || "未排序"
  )
}
