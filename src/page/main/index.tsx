import { useAtomValue } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import { hasTabsAtom } from "@/lib/tabs"
import { CodeArea } from "./code-area"
import { Divider } from "./divider"
import { EmptyPage } from "./empty-page"
import { ExecLog } from "./exec-log"
import { TabBar } from "./tab-bar"
import { TableArea } from "./table-area"

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_TABLE_HEIGHT = 240
const INITIAL_LOG_WIDTH = 300

const MIN_TABLE_HEIGHT = 80
const MIN_BOTTOM_HEIGHT = 120
const MIN_LOG_WIDTH = 160
const MIN_CODE_WIDTH = 160

// ─── Drag State ───────────────────────────────────────────────────────────────

type DragType = "h-divider" | "v-divider"

interface DragState {
  type: DragType
  startPos: number
  startSize: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Main() {
  // tableHeight  — pixel height given to the table panel
  // logWidth     — pixel width given to the log panel
  const hasTabs = useAtomValue(hasTabsAtom)
  const [tableHeight, setTableHeight] = useState(INITIAL_TABLE_HEIGHT)
  const [logWidth, setLogWidth] = useState(INITIAL_LOG_WIDTH)

  const dragging = useRef<DragState | null>(null)
  const containerRef = useRef<HTMLElement>(null)

  // ── Mouse move / up handlers (attached to document during drag) ────────────

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const d = dragging.current
    if (!d) return

    if (d.type === "h-divider") {
      // Vertical mouse movement → resize table height
      const delta = e.clientY - d.startPos
      const container = containerRef.current
      if (container) {
        const maxHeight =
          container.clientHeight - MIN_BOTTOM_HEIGHT - /* divider */ 5
        setTableHeight(
          Math.min(maxHeight, Math.max(MIN_TABLE_HEIGHT, d.startSize + delta)),
        )
      } else {
        setTableHeight(Math.max(MIN_TABLE_HEIGHT, d.startSize + delta))
      }
    } else {
      // Horizontal mouse movement → resize log width
      // Log is on the right; dragging left (negative delta) grows it
      const delta = d.startPos - e.clientX
      const container = containerRef.current
      if (container) {
        const maxWidth =
          container.clientWidth - MIN_CODE_WIDTH - /* divider */ 5
        setLogWidth(
          Math.min(maxWidth, Math.max(MIN_LOG_WIDTH, d.startSize + delta)),
        )
      } else {
        setLogWidth(Math.max(MIN_LOG_WIDTH, d.startSize + delta))
      }
    }
  }, [])

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

  // ── Divider mouse-down starters ───────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main
      ref={containerRef}
      className="col-start-2 col-span-1 flex flex-col overflow-hidden"
    >
      {/* Tab bar — fixed height */}
      <TabBar />

      {/* Main content area */}
      {hasTabs ? (
        <>
          {/* Table area — controlled height */}
          <div
            className="shrink-0 overflow-hidden"
            style={{ height: tableHeight }}
          >
            <TableArea />
          </div>

          {/* Horizontal divider — resizes table / bottom split */}
          <Divider orientation="horizontal" onMouseDown={onHDividerMouseDown} />

          {/* Bottom section: code editor + vertical divider + exec log */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Code area — fills remaining width */}
            <div className="flex-1 overflow-hidden min-w-0">
              <CodeArea />
            </div>

            {/* Vertical divider — resizes code / log split */}
            <Divider orientation="vertical" onMouseDown={onVDividerMouseDown} />

            {/* Exec log — controlled width */}
            <div
              className="shrink-0 overflow-hidden border-l"
              style={{ width: logWidth }}
            >
              <ExecLog />
            </div>
          </div>
        </>
      ) : (
        <EmptyPage />
      )}
    </main>
  )
}
