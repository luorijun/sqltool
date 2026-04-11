import type React from "react"
import { cn } from "@/lib/utils"

export interface DividerProps {
  orientation: "horizontal" | "vertical"
  onMouseDown: (e: React.MouseEvent) => void
  className?: string
}

export function Divider({ orientation, onMouseDown, className }: DividerProps) {
  const isHorizontal = orientation === "horizontal"

  return (
    <button
      type="button"
      aria-label={isHorizontal ? "上下拖拽调节高度" : "左右拖拽调节宽度"}
      className={cn(
        "relative shrink-0 select-none group z-10",
        "bg-transparent border-none outline-none p-0",
        "transition-colors hover:bg-primary/10 active:bg-primary/20",
        isHorizontal
          ? "h-1.25 w-full cursor-row-resize"
          : "w-1.25 h-full cursor-col-resize",
        className,
      )}
      onMouseDown={onMouseDown}
    >
      {/* Visible line */}
      <div
        className={cn(
          "absolute pointer-events-none transition-colors",
          "bg-border group-hover:bg-ring/50",
          isHorizontal ? "inset-x-0 top-0.5 h-px" : "inset-y-0 left-0.5 w-px",
        )}
      />

      {/* Center drag handle */}
      <div
        className={cn(
          "absolute pointer-events-none flex items-center justify-center",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          isHorizontal
            ? "inset-0 justify-center"
            : "inset-0 items-center flex-col",
        )}
      >
        <div
          className={cn(
            "rounded-full bg-ring/70",
            isHorizontal ? "h-1 w-8" : "w-1 h-8",
          )}
        />
      </div>
    </button>
  )
}
