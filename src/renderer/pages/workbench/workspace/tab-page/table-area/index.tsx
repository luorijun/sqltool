import { useAtomValue, useSetAtom } from "jotai"
import { CircleX, Loader2 } from "lucide-react"
import {
  EmptyState,
  type ResultLayout,
  ResultTable,
} from "@/renderer/components/result-grid"
import {
  activeQueryRunningAtom,
  activeQueryTabTableStateAtom,
  activeResultStaleAtom,
  activeTabIdAtom,
  copyOptionsAtom,
  resetActiveQueryTabTableStateAtom,
  setCopyOptionsAtom,
  setTableSelectionAtom,
  updateQueryLayoutAtom,
} from "@/renderer/modules/workspace"
import { saveText, showError } from "../../feedback"

export default function QueryTableArea() {
  const tableState = useAtomValue(activeQueryTabTableStateAtom)
  const tabId = useAtomValue(activeTabIdAtom)
  const copyOptions = useAtomValue(copyOptionsAtom)
  const setCopyOptions = useSetAtom(setCopyOptionsAtom)
  const setSelection = useSetAtom(setTableSelectionAtom)
  const update = useSetAtom(updateQueryLayoutAtom)
  const setTableState = (change: (current: ResultLayout) => ResultLayout) => {
    if (tabId === null) return
    update({ tabId, update: change })
  }
  const resetTableState = useSetAtom(resetActiveQueryTabTableStateAtom)
  const running = useAtomValue(activeQueryRunningAtom)
  const { status, error } = tableState
  const stale = useAtomValue(activeResultStaleAtom)

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
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={error ?? "查询执行失败"}
      />
    )
  }

  return (
    <ResultTable
      readOnly
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
      statusBarEnd={
        <>
          {(stale || status === "error") && <span>此前执行的结果</span>}
          {error && <span className="text-destructive">{error}</span>}
        </>
      }
    />
  )
}
