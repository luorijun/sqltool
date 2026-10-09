import type { SortingState } from "@tanstack/react-table"
import { CircleX, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/renderer/components/ui/button"
import type { ResultActions, ResultLayout, ResultTableState } from "./model"
import { Paging } from "./paging"
import type { GridSelection } from "./selection"
import type { CopyOptions } from "./serialize"
import { EmptyState, ResultTable } from "./table"

export { getTypeLabel } from "./format"
export type { ResultLayout, ResultTableState } from "./model"
export type { GridSelection } from "./selection"
export type { CopyOptions } from "./serialize"

interface TableAreaBase extends ResultActions {
  id: string | null
  tableState: ResultTableState & {
    status: "idle" | "running" | "success" | "error"
    error: string | null
  }
  stale: boolean
  copyOptions: CopyOptions
  onCopyOptionsChange: (options: CopyOptions) => void
  onSelectionChange: (selection: GridSelection | null) => void
  onLayoutChange: (update: (current: ResultLayout) => ResultLayout) => void
  onReset: () => void
}
export type TableAreaProps = TableAreaBase &
  (
    | { mode: "query"; running: boolean }
    | {
        mode: "view"
        busy: boolean
        running: boolean
        cancelling: boolean
        sorting: SortingState
        sortOrder: string[]
        exportNamePrefix: string
        countError: string | null
        pagination: {
          offset: number
          limit: number
          page: number
          totalPages: number | null
          total: number | null
          hasNext: boolean
        }
        onCancel: () => void
        onRefresh: () => void
        onSortingChange: (sorting: SortingState, order: string[]) => void
        onPage: (page: number) => void
        onSize: (size: number) => void
        onRange: (range: { offset: number; limit: number }) => void
      }
  )

export function TableArea(props: TableAreaProps) {
  const {
    id,
    tableState,
    stale,
    copyOptions,
    onCopyOptionsChange,
    onSelectionChange,
    onExport,
    onError,
    onLayoutChange,
    onReset,
  } = props
  if (props.mode === "query") {
    const { running } = props
    const { status, error } = tableState
    if (status === "idle" && !running) {
      return <EmptyState message="运行 SQL 语句以查看结果" />
    }

    if (running) {
      return (
        <EmptyState
          icon={<Loader2 className="size-8 text-primary/40 animate-spin" />}
          message="正在执行 SQL..."
        />
      )
    }

    if (status === "error" && !tableState.dataAt) {
      return (
        <EmptyState
          icon={
            <CircleX className="size-8 text-destructive/40 stroke-[1.25]" />
          }
          message={error ?? "查询执行失败"}
        />
      )
    }

    return (
      <ResultTable
        readOnly
        key={`${id}:${tableState.dataAt}`}
        copyOptions={copyOptions}
        onCopyOptionsChange={onCopyOptionsChange}
        onSelectionChange={onSelectionChange}
        onExport={onExport}
        onError={onError}
        tableState={tableState}
        onLayoutChange={onLayoutChange}
        onReset={onReset}
        statusBarEnd={
          <>
            {(stale || status === "error") && <span>此前执行的结果</span>}
            {error && <span className="text-destructive">{error}</span>}
          </>
        }
      />
    )
  }
  const {
    busy,
    running,
    cancelling,
    sorting,
    sortOrder,
    exportNamePrefix,
    countError,
    pagination,
    onCancel,
    onRefresh,
    onSortingChange,
    onPage,
    onSize,
    onRange,
  } = props
  const { page, totalPages, total, hasNext } = pagination
  const initialLoading =
    tableState.status === "running" && tableState.dataAt === null
  if (tableState.status === "idle" || initialLoading) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary/40" />
        <p className="text-xs text-muted-foreground">正在加载数据表...</p>
        <Button
          variant="outline"
          size="xs"
          onClick={onCancel}
          disabled={cancelling}
        >
          停止加载
        </Button>
      </div>
    )
  }

  if (tableState.status === "error" && tableState.dataAt === null) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 px-4 text-center">
        <CircleX className="size-8 stroke-[1.25] text-destructive/40" />
        <p className="text-xs text-muted-foreground">
          {tableState.error ?? "数据表加载失败"}
        </p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </div>
    )
  }

  return (
    <ResultTable
      key={`${id}:${tableState.dataAt}`}
      copyOptions={copyOptions}
      onCopyOptionsChange={onCopyOptionsChange}
      onSelectionChange={onSelectionChange}
      onExport={onExport}
      onError={onError}
      tableState={tableState}
      onLayoutChange={onLayoutChange}
      onReset={onReset}
      readOnly={false}
      sorting={sorting}
      sortOrder={sortOrder}
      busy={busy}
      onSortingChange={onSortingChange}
      emptyMessage="数据表暂无数据"
      exportNamePrefix={exportNamePrefix}
      toolbarActions={
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          disabled={cancelling}
          onClick={() => {
            if (running) onCancel()
            else onRefresh()
          }}
          title={running ? "停止查询" : "刷新数据和总行数"}
        >
          {running ? (
            <CircleX className="size-3" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {cancelling ? "正在停止" : running ? "停止" : "刷新"}
        </Button>
      }
      toolbarQuery={
        <Paging
          key={tableState.dataAt}
          offset={pagination.offset}
          limit={pagination.limit}
          page={page}
          totalPages={totalPages}
          total={total}
          hasNext={hasNext}
          busy={busy}
          onPage={onPage}
          onSize={onSize}
          onRange={onRange}
        />
      }
      statusBarStart={
        <>
          <span title={countError ?? undefined}>
            共 {total?.toLocaleString() ?? "-"} 行
          </span>
          <span>
            第 {page} / {totalPages ?? "-"} 页
          </span>
        </>
      }
      statusBarEnd={
        <>
          {stale && <span>此前执行的结果</span>}
          {tableState.error && (
            <span className="text-destructive">{tableState.error}</span>
          )}
        </>
      }
    />
  )
}
