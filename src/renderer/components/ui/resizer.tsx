import { Button as ButtonPrimitive } from "@base-ui/react"
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
import { cn } from "tailwind-variants"

type ResizeAxis = "x" | "y"
type FixedPane = "first" | "second"

const DIVIDER_SIZE = 11

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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<number | null>(null)

  const updatePosition = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const button = buttonRef.current
      if (!button) {
        return
      }

      const rect = button.getBoundingClientRect()
      const length = isHorizontal ? rect.width : rect.height
      const offset = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top
      const inset = Math.min(8, length / 2)
      setPosition(Math.min(length - inset, Math.max(inset, offset)))
    },
    [isHorizontal],
  )

  useEffect(() => {
    if (!active) {
      return
    }

    document.addEventListener("mousemove", updatePosition)
    return () => document.removeEventListener("mousemove", updatePosition)
  }, [active, updatePosition])

  return (
    <ButtonPrimitive
      ref={buttonRef}
      type="button"
      aria-label={
        ariaLabel ?? (isHorizontal ? "上下拖拽调节高度" : "左右拖拽调节宽度")
      }
      className={cn(
        "group relative shrink-0 self-stretch overflow-hidden touch-none select-none p-0 text-muted-foreground outline-none transition-colors focus-visible:bg-primary/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-muted" : "bg-muted/50 hover:bg-muted",
        isHorizontal ? "cursor-row-resize border-t border-b" : "cursor-col-resize border-l border-r",
        className,
      )}
      style={getPaneStyle(isHorizontal ? "y" : "x", DIVIDER_SIZE)}
      onMouseEnter={updatePosition}
      onMouseMove={updatePosition}
      onMouseDown={(e) => {
        updatePosition(e)
        onMouseDown(e)
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 transition-opacity",
          active
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
        style={
          isHorizontal
            ? { left: position ?? "50%" }
            : { top: position ?? "50%" }
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 8"
          fill="currentColor"
          className={cn("h-2 w-4", !isHorizontal && "rotate-90")}
        >
          <circle cx="3" cy="2" r="1" />
          <circle cx="8" cy="2" r="1" />
          <circle cx="13" cy="2" r="1" />
          <circle cx="3" cy="6" r="1" />
          <circle cx="8" cy="6" r="1" />
          <circle cx="13" cy="6" r="1" />
        </svg>
      </span>
    </ButtonPrimitive>
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

    const size = axis === "x" ? container.clientWidth : container.clientHeight
    return Math.max(0, size - DIVIDER_SIZE)
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
