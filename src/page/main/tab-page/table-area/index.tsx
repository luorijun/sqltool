import { useAtomValue } from "jotai"
import { CircleX, Loader2 } from "lucide-react"
import {
  activeTabResultAtom,
  activeTabTableStateAtom,
} from "@/lib/tabs/renderer"
import { EmptyState } from "./empty"
import { ResultTable } from "./table"

export function TableArea() {
  const result = useAtomValue(activeTabResultAtom)
  const tableUi = useAtomValue(activeTabTableStateAtom)

  if (!result || !tableUi) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (result.status === "running") {
    return (
      <EmptyState
        icon={<Loader2 className="size-8 text-primary/40 animate-spin" />}
        message="正在执行 SQL..."
      />
    )
  }

  if (result.status === "error") {
    return (
      <EmptyState
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={result.error ?? "查询执行失败"}
      />
    )
  }

  if (result.status !== "success") {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  return <ResultTable result={result} tableUi={tableUi} />
}
