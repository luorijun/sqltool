import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { CircleX, Loader2 } from "lucide-react"
import {
  activeQueryTabTableStateAtom,
  activeResultStaleAtom,
  resetActiveQueryTabTableStateAtom,
} from "@/lib/tabs/renderer"
import { EmptyState } from "./empty"
import { ResultTable } from "./table"

export default function QueryTableArea() {
  const [tableState, setTableState] = useAtom(activeQueryTabTableStateAtom)
  const resetTableState = useSetAtom(resetActiveQueryTabTableStateAtom)
  const { status, error } = tableState
  const stale = useAtomValue(activeResultStaleAtom)

  if (status === "idle") {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (status === "running") {
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
      tableState={tableState}
      setTableState={setTableState}
      onReset={resetTableState}
      statusBarEnd={
        <>
          {(stale || status === "error") && <span>此前执行的结果</span>}
          {error && <span className="text-destructive">{error}</span>}
        </>
      }
    />
  )
}
