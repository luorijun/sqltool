import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Divider } from "../divider"
import { CodeArea } from "./code-area"
import LogArea from "./log-area"
import { TableArea } from "./table-area"

const DIVIDER_SIZE = 5

const MIN_TABLE_HEIGHT = 80
const MIN_BOTTOM_HEIGHT = 120
const MIN_LOG_WIDTH = 240
const MIN_CODE_WIDTH = 160

type DragType = "h-divider" | "v-divider"

interface DragState {
  type: DragType
  startPos: number
  startSize: number
}

function clampTableHeight(containerHeight: number, value: number): number {
  const maxHeight = Math.max(
    MIN_TABLE_HEIGHT,
    containerHeight - MIN_BOTTOM_HEIGHT - DIVIDER_SIZE,
  )

  return Math.min(maxHeight, Math.max(MIN_TABLE_HEIGHT, value))
}

function clampLogWidth(containerWidth: number, value: number): number {
  const maxWidth = Math.max(
    MIN_LOG_WIDTH,
    containerWidth - MIN_CODE_WIDTH - DIVIDER_SIZE,
  )

  return Math.min(maxWidth, Math.max(MIN_LOG_WIDTH, value))
}

export default function TabPage() {
  const [tableHeight, setTableHeight] = useState(0)
  const [logWidth, setLogWidth] = useState(0)
  const [isReady, setIsReady] = useState(false)

  const dragging = useRef<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const measureContainer = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return null
    }

    return {
      width: container.clientWidth,
      height: container.clientHeight,
    }
  }, [])

  useLayoutEffect(() => {
    const size = measureContainer()
    if (!size) {
      return
    }

    const initialTableHeight = clampTableHeight(
      size.height,
      ((size.height - DIVIDER_SIZE) * 2) / 3,
    )
    const initialLogWidth = clampLogWidth(
      size.width,
      (size.width - DIVIDER_SIZE) / 3,
    )

    setTableHeight(initialTableHeight)
    setLogWidth(initialLogWidth)
    setIsReady(true)
  }, [measureContainer])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const observer = new ResizeObserver(() => {
      const size = measureContainer()
      if (!size) {
        return
      }

      setTableHeight((prev) => clampTableHeight(size.height, prev))
      setLogWidth((prev) => clampLogWidth(size.width, prev))
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [measureContainer])

  const onHDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      dragging.current = {
        type: "h-divider",
        startPos: e.clientY,
        startSize: tableHeight,
      }
      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
      e.preventDefault()
    },
    [tableHeight],
  )

  const onVDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      dragging.current = {
        type: "v-divider",
        startPos: e.clientX,
        startSize: logWidth,
      }
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      e.preventDefault()
    },
    [logWidth],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const d = dragging.current
      const size = measureContainer()

      if (!d || !size) {
        return
      }

      if (d.type === "h-divider") {
        const delta = e.clientY - d.startPos
        setTableHeight(clampTableHeight(size.height, d.startSize + delta))
        return
      }

      const delta = d.startPos - e.clientX
      setLogWidth(clampLogWidth(size.width, d.startSize + delta))
    },
    [measureContainer],
  )

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const gridTemplateRows = isReady
    ? `${tableHeight}px ${DIVIDER_SIZE}px minmax(${MIN_BOTTOM_HEIGHT}px, 1fr)`
    : `minmax(${MIN_TABLE_HEIGHT}px, 2fr) ${DIVIDER_SIZE}px minmax(${MIN_BOTTOM_HEIGHT}px, 1fr)`

  const gridTemplateColumns = isReady
    ? `minmax(${MIN_CODE_WIDTH}px, 1fr) ${DIVIDER_SIZE}px ${logWidth}px`
    : `minmax(${MIN_CODE_WIDTH}px, 2fr) ${DIVIDER_SIZE}px minmax(${MIN_LOG_WIDTH}px, 1fr)`

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 grid overflow-hidden"
      style={{
        gridTemplateRows,
        gridTemplateColumns,
      }}
    >
      <div className="row-1 col-[1/4] min-h-0 overflow-hidden">
        <TableArea />
      </div>

      <Divider
        orientation="horizontal"
        onMouseDown={onHDividerMouseDown}
        className="row-2 col-[1/4] h-1.25 w-full"
      />

      <div className="row-3 col-1 min-h-0 min-w-0 overflow-hidden">
        <CodeArea />
      </div>

      <Divider
        orientation="vertical"
        onMouseDown={onVDividerMouseDown}
        className="row-3 col-2 h-full w-1.25"
      />

      <div className="row-3 col-3 min-h-0 overflow-hidden">
        <LogArea />
      </div>
    </div>
  )
}
