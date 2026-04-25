import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { cn } from "@/lib/utils"

type ResizeAxis = "x" | "y"
type FixedPane = "first" | "second"

interface DragState {
  startPos: number
  startSize: number
}

function clampSize(
  containerSize: number,
  minSize: number,
  minRemainingSize: number,
  value: number,
): number {
  const maxSize = Math.max(minSize, containerSize - minRemainingSize)

  return Math.min(maxSize, Math.max(minSize, value))
}

function getPaneStyle(axis: ResizeAxis, size: number): CSSProperties {
  return axis === "x" ? { width: size } : { height: size }
}

export interface ResizeDividerProps {
  orientation: "horizontal" | "vertical"
  onMouseDown: (e: ReactMouseEvent<HTMLButtonElement>) => void
  active?: boolean
  className?: string
  ariaLabel?: string
}

export function ResizeDivider({
  orientation,
  onMouseDown,
  active = false,
  className,
  ariaLabel,
}: ResizeDividerProps) {
  const isHorizontal = orientation === "horizontal"

  return (
    <div
      className={cn(
        "group relative z-40 shrink-0 overflow-visible self-stretch",
        // isHorizontal ? "h-px" : "w-px",
        className,
      )}
    >
      <div
        className={cn(
          "trans transition-colors",
          active ? "border-border" : "group-hover:border-primary",
          isHorizontal ? "border-b w-full" : "border-r h-full",
        )}
      />

      <button
        type="button"
        aria-label={
          ariaLabel ?? (isHorizontal ? "上下拖拽调节高度" : "左右拖拽调节宽度")
        }
        className={cn(
          "absolute touch-none select-none border-none bg-transparent p-0 outline-none",
          isHorizontal
            ? "inset-x-0 top-1/2 h-2.75 -translate-y-1/2 cursor-row-resize"
            : "inset-y-0 left-1/2 w-2.75 -translate-x-1/2 cursor-col-resize",
        )}
        onMouseDown={onMouseDown}
      >
        <span
          className={cn(
            "pointer-events-none absolute rounded-full bg-primary/40 transition-opacity",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            isHorizontal
              ? "top-1/2 left-1/2 h-1.25 w-8 -translate-1/2"
              : "top-1/2 left-1/2 h-8 w-1.25 -translate-1/2",
          )}
        />
      </button>
    </div>
  )
}

export interface ResizeContainerProps {
  axis: ResizeAxis
  fixed: FixedPane
  defaultSize: number | ((containerSize: number) => number)
  minSize: number
  minRemainingSize: number
  first: ReactNode
  second: ReactNode
  className?: string
  firstClassName?: string
  secondClassName?: string
  dividerLabel?: string
}

export function ResizeContainer({
  axis,
  fixed,
  defaultSize,
  minSize,
  minRemainingSize,
  first,
  second,
  className,
  firstClassName,
  secondClassName,
  dividerLabel,
}: ResizeContainerProps) {
  const [size, setSize] = useState(() =>
    typeof defaultSize === "number" ? defaultSize : 0,
  )
  const [isReady, setIsReady] = useState(typeof defaultSize === "number")
  const [active, setActive] = useState(false)

  const dragging = useRef<DragState | null>(null)
  const initialized = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const measureContainer = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return null
    }

    return axis === "x" ? container.clientWidth : container.clientHeight
  }, [axis])

  const resolveDefaultSize = useCallback(
    (containerSize: number) =>
      typeof defaultSize === "function"
        ? defaultSize(containerSize)
        : defaultSize,
    [defaultSize],
  )

  useLayoutEffect(() => {
    if (initialized.current) {
      return
    }

    const containerSize = measureContainer()
    if (containerSize === null) {
      return
    }

    setSize(
      clampSize(
        containerSize,
        minSize,
        minRemainingSize,
        resolveDefaultSize(containerSize),
      ),
    )
    setIsReady(true)
    initialized.current = true
  }, [measureContainer, minRemainingSize, minSize, resolveDefaultSize])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const observer = new ResizeObserver(() => {
      const containerSize = measureContainer()
      if (containerSize === null) {
        return
      }

      setSize((prev) =>
        clampSize(containerSize, minSize, minRemainingSize, prev),
      )
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [measureContainer, minRemainingSize, minSize])

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      dragging.current = {
        startPos: axis === "x" ? e.clientX : e.clientY,
        startSize: size,
      }
      setActive(true)
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
      document.body.style.userSelect = "none"
      e.preventDefault()
    },
    [axis, size],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const dragState = dragging.current
      const containerSize = measureContainer()

      if (!dragState || containerSize === null) {
        return
      }

      const currentPos = axis === "x" ? e.clientX : e.clientY
      const delta = currentPos - dragState.startPos
      const nextSize =
        fixed === "first"
          ? dragState.startSize + delta
          : dragState.startSize - delta

      setSize(clampSize(containerSize, minSize, minRemainingSize, nextSize))
    },
    [axis, fixed, measureContainer, minRemainingSize, minSize],
  )

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) {
      return
    }

    dragging.current = null
    setActive(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      dragging.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [active, handleMouseMove, handleMouseUp])

  const firstStyle =
    fixed === "first" && isReady ? getPaneStyle(axis, size) : undefined
  const secondStyle =
    fixed === "second" && isReady ? getPaneStyle(axis, size) : undefined

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 min-w-0",
        axis === "x" ? "flex-row" : "flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "min-h-0 min-w-0 overflow-hidden",
          fixed === "first" ? "shrink-0" : "flex-1",
          firstClassName,
        )}
        style={firstStyle}
      >
        {first}
      </div>

      <ResizeDivider
        orientation={axis === "x" ? "vertical" : "horizontal"}
        active={active}
        onMouseDown={handleMouseDown}
        ariaLabel={dividerLabel}
      />

      <div
        className={cn(
          "min-h-0 min-w-0 overflow-hidden",
          fixed === "second" ? "shrink-0" : "flex-1",
          secondClassName,
        )}
        style={secondStyle}
      >
        {second}
      </div>
    </div>
  )
}
