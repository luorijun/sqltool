import { CircleX, Loader2 } from "lucide-react"
import { useActiveTabTableState } from "@/lib/tabs/hooks"
import { EmptyState } from "./empty"
import { ResultTable } from "./table"

export function TableArea() {
  const { result, tableUi } = useActiveTabTableState()

  if (!result || !tableUi) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  if (result.running) {
    return (
      <EmptyState
        icon={<Loader2 className="size-8 text-primary/40 animate-spin" />}
        message="正在执行 SQL..."
      />
    )
  }

  if (result.error) {
    return (
      <EmptyState
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={result.error}
      />
    )
  }

  if (!result.executed) {
    return <EmptyState message="运行 SQL 语句以查看结果" />
  }

  return <ResultTable result={result} tableUi={tableUi} />
}
