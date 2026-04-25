import { Table2 } from "lucide-react"
import type { ReactNode } from "react"

export function EmptyState({
  icon,
  message,
}: {
  icon?: ReactNode
  message: string
}) {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-2 text-center select-none">
      {icon ?? (
        <Table2 className="size-8 text-muted-foreground/25 stroke-[1.25]" />
      )}
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
