import { atom, useAtomValue } from "jotai"
import { CircleX, Loader2 } from "lucide-react"
import { activeTabTableStateAtom } from "@/lib/tabs/renderer"
import { EmptyState } from "./empty"
import { ResultTable } from "./table"

const statusAtom = atom((get) => get(activeTabTableStateAtom).status)
const errorAtom = atom((get) => get(activeTabTableStateAtom).error)

export default function TableArea() {
  const status = useAtomValue(statusAtom)
  const error = useAtomValue(errorAtom)

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

  if (status === "error") {
    return (
      <EmptyState
        icon={<CircleX className="size-8 text-destructive/40 stroke-[1.25]" />}
        message={error ?? "查询执行失败"}
      />
    )
  }

  return <ResultTable />
}
