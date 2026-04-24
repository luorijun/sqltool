import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type PanelBarProps = ComponentProps<"div">

export function PanelToolbar({ className, ...props }: PanelBarProps) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 shrink-0 items-center gap-1 border-b bg-muted/50 px-2",
        className,
      )}
      {...props}
    />
  )
}

export function PanelStatusBar({ className, ...props }: PanelBarProps) {
  return (
    <div
      className={cn(
        "flex h-6 min-w-0 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-t px-2 text-[10px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}
