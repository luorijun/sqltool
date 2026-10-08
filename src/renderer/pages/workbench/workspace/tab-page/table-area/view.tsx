import { useAtomValue, useSetAtom } from "jotai"
import { CircleX, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import {
  type ResultLayout,
  ResultTable,
} from "@/renderer/components/result-grid"
import { Button } from "@/renderer/components/ui/button"
import {
  activeResultStaleAtom,
  activeTabIdAtom,
  activeViewTabAtom,
  activeViewTableAtom,
  cancelViewAtom,
  copyOptionsAtom,
  getPagination,
  refreshViewAtom,
  resetViewLayoutAtom,
  setCopyOptionsAtom,
  setTableSelectionAtom,
  setViewPageAtom,
  setViewPageSizeAtom,
  setViewRangeAtom,
  setViewSortAtom,
  updateViewLayoutAtom,
} from "@/renderer/modules/workspace"
import { saveText, showError } from "../../feedback"
import { Paging } from "./paging"

export default function ViewTableArea() {
  const tableState = useAtomValue(activeViewTableAtom)
  const tabId = useAtomValue(activeTabIdAtom)
  const copyOptions = useAtomValue(copyOptionsAtom)
  const setCopyOptions = useSetAtom(setCopyOptionsAtom)
  const setSelection = useSetAtom(setTableSelectionAtom)
  const update = useSetAtom(updateViewLayoutAtom)
  const setTableState = (change: (current: ResultLayout) => ResultLayout) => {
    if (tabId === null) return
    update({ tabId, update: change })
  }
  const viewTab = useAtomValue(activeViewTabAtom)
  const stale = useAtomValue(activeResultStaleAtom)
  const cancel = useSetAtom(cancelViewAtom)
  const cancelling = viewTab?.cancelling ?? false
  const stop = async () => {
    try {
      if (tabId !== null) await cancel({ tabId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消失败")
    }
  }
  const resetTableState = useSetAtom(resetViewLayoutAtom)
  const refresh = useSetAtom(refreshViewAtom)
  const setPage = useSetAtom(setViewPageAtom)
  const setPageSize = useSetAtom(setViewPageSizeAtom)
  const setSort = useSetAtom(setViewSortAtom)
  const setRange = useSetAtom(setViewRangeAtom)

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
          onClick={stop}
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (tabId !== null) void refresh({ tabId })
          }}
        >
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </div>
    )
  }

  const busy = tableState.status === "running"
  const running = busy || tableState.countStatus === "running"
  const total =
    busy || tableState.countStatus !== "success" ? null : tableState.totalCount
  const { page, totalPages } = getPagination(
    tableState.offset,
    tableState.limit,
    total,
  )
  const hasNext =
    total === null
      ? tableState.data.length === tableState.limit
      : tableState.offset + tableState.limit < total
  const sorting = tableState.sort.flatMap((order) => {
    const column = tableState.columns.find(
      (column) => (column.sourceColumn ?? column.name) === order.column,
    )
    return column ? [{ id: column.id, desc: order.direction === "desc" }] : []
  })

  return (
    <ResultTable
      key={`${tabId}:${tableState.dataAt}`}
      copyOptions={copyOptions}
      onCopyOptionsChange={setCopyOptions}
      onSelectionChange={(selection) => {
        if (tabId !== null) setSelection({ tabId, selection })
      }}
      onExport={saveText}
      onError={showError}
      tableState={tableState}
      onLayoutChange={setTableState}
      onReset={() => {
        if (tabId !== null) resetTableState({ tabId })
      }}
      readOnly={false}
      sorting={sorting}
      sortOrder={tableState.sortOrder}
      busy={busy}
      onSortingChange={(sorting, order) => {
        if (tabId === null) return
        const sort = sorting.flatMap((order) => {
          const column = tableState.columns.find(
            (column) => column.id === order.id,
          )
          return column
            ? [
                {
                  column: column.sourceColumn ?? column.name,
                  direction: order.desc ? ("desc" as const) : ("asc" as const),
                },
              ]
            : []
        })
        if (sort.length === sorting.length) void setSort({ tabId, sort, order })
      }}
      emptyMessage="数据表暂无数据"
      exportNamePrefix={viewTab ? `${viewTab.source.table}-data` : "table-data"}
      toolbarActions={
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          disabled={cancelling}
          onClick={() => {
            if (running) void stop()
            else if (tabId !== null) void refresh({ tabId })
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
          offset={tableState.offset}
          limit={tableState.limit}
          page={page}
          totalPages={totalPages}
          total={total}
          hasNext={hasNext}
          busy={busy}
          onPage={(page) => {
            if (tabId !== null) void setPage({ tabId, page })
          }}
          onSize={(limit) => {
            if (tabId !== null) void setPageSize({ tabId, limit })
          }}
          onRange={(range) => {
            if (tabId !== null) void setRange({ tabId, ...range })
          }}
        />
      }
      statusBarStart={
        <>
          <span title={tableState.countError ?? undefined}>
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
