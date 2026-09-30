import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  columnAt,
  dragScroll,
  measureGrid,
  revealDelta,
  rowAt,
} from "./geometry"
import {
  beginSelection,
  type CellPosition,
  type GridSelection,
  movePosition,
  type SelectionGesture,
  type SelectionMode,
  updateSelection,
} from "./selection"

interface Context {
  data: unknown[]
  columnKey: string
}
interface Drag extends Context {
  base: GridSelection | null
  gesture: SelectionGesture
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
  value: GridSelection
}
interface KeySelection extends Context {
  gesture: SelectionGesture
  ctrl: boolean
  shift: boolean
  expected: GridSelection
}

export function useSelection({
  selection,
  onChange,
  data,
  columns,
}: {
  selection: GridSelection | null
  onChange: (selection: GridSelection | null) => void
  data: unknown[]
  columns: string[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const keys = useRef<KeySelection | null>(null)
  const frame = useRef(0)
  const columnKey = JSON.stringify(columns)
  const [draft, setDraft] = useState<
    (Context & { base: GridSelection | null; value: GridSelection }) | null
  >(null)
  const value =
    draft?.base === selection &&
    draft.data === data &&
    draft.columnKey === columnKey
      ? draft.value
      : selection

  useEffect(() => {
    const current = drag.current
    if (
      current &&
      (current.data !== data ||
        current.columnKey !== columnKey ||
        current.base !== selection)
    ) {
      drag.current = null
      cancelAnimationFrame(frame.current)
      if (ref.current?.hasPointerCapture(current.pointerId))
        ref.current.releasePointerCapture(current.pointerId)
    }
    const keyboard = keys.current
    if (
      keyboard &&
      (keyboard.data !== data ||
        keyboard.columnKey !== columnKey ||
        keyboard.expected !== selection)
    )
      keys.current = null
  }, [data, columnKey, selection])

  useEffect(() => {
    const root = ref.current
    const cancel = () => {
      const current = drag.current
      drag.current = null
      keys.current = null
      cancelAnimationFrame(frame.current)
      if (current && root?.hasPointerCapture(current.pointerId))
        root.releasePointerCapture(current.pointerId)
    }
    const blur = () => {
      cancel()
      setDraft(null)
    }
    window.addEventListener("blur", blur)
    return () => {
      cancel()
      window.removeEventListener("blur", blur)
    }
  }, [])

  function finish(commit: boolean) {
    const current = drag.current
    drag.current = null
    cancelAnimationFrame(frame.current)
    setDraft(null)
    if (current && ref.current?.hasPointerCapture(current.pointerId))
      ref.current.releasePointerCapture(current.pointerId)
    if (current && commit) onChange(current.value)
  }

  function pointAt(
    element: Element | null,
  ): { point: CellPosition; mode: SelectionMode } | null {
    const cell = element?.closest<HTMLElement>("[data-grid-row][data-grid-col]")
    if (
      !cell ||
      !ref.current?.contains(cell) ||
      !columns.length ||
      !data.length
    )
      return null
    const row = Number(cell.dataset.gridRow)
    const col = cell.dataset.gridCol ?? ""
    const header = row === -1
    const serial = col === ""
    return {
      point: {
        row: header ? (value?.active.row ?? 0) : row,
        col: serial ? (value?.active.col ?? columns[0]) : col,
      },
      mode: header ? (serial ? "all" : "columns") : serial ? "rows" : "cells",
    }
  }

  function updateDrag(scroll: boolean) {
    const current = drag.current
    const root = ref.current
    if (!current || !root || !current.moved) return
    let bounds = measureGrid(root)
    if (scroll) {
      const delta = dragScroll(
        bounds,
        current.x,
        current.y,
        current.gesture.mode,
      )
      const left = root.scrollLeft
      const top = root.scrollTop
      root.scrollLeft += delta.x
      root.scrollTop += delta.y
      if (left !== root.scrollLeft || top !== root.scrollTop)
        bounds = measureGrid(root)
    }
    const mode = current.gesture.mode
    const row =
      mode === "columns"
        ? current.value.active.row
        : (rowAt(root, bounds, current.y) ?? current.value.active.row)
    const col =
      mode === "rows"
        ? current.gesture.anchor.col
        : (columnAt(bounds, current.x) ?? current.value.active.col)
    const point = { row, col }
    if (
      point.row === current.value.active.row &&
      point.col === current.value.active.col
    )
      return
    current.value = updateSelection(current.gesture, point)
    setDraft({ base: current.base, data, columnKey, value: current.value })
  }

  function tick() {
    updateDrag(true)
    if (drag.current) frame.current = requestAnimationFrame(tick)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    if (
      !(event.target instanceof Element) ||
      event.target.closest("button, input, [role=menuitem]")
    )
      return
    const hit = pointAt(event.target)
    if (!hit) return
    event.preventDefault()
    keys.current = null
    ref.current
      ?.querySelector<HTMLElement>("[role=grid]")
      ?.focus({ preventScroll: true })
    const gesture = beginSelection(
      value,
      hit.point,
      hit.mode,
      data.length,
      columns,
      { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey },
    )
    if (!gesture) return
    const next = updateSelection(gesture, hit.point)
    if (hit.mode === "all") {
      onChange(next)
      return
    }
    drag.current = {
      base: selection,
      data,
      columnKey,
      gesture,
      pointerId: event.pointerId,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      value: next,
    }
    setDraft({ base: selection, data, columnKey, value: next })
    event.currentTarget.setPointerCapture(event.pointerId)
    frame.current = requestAnimationFrame(tick)
  }

  function reveal(point: CellPosition) {
    const root = ref.current
    const cell = root?.querySelector<HTMLElement>(
      `[data-grid-row="${point.row}"][data-grid-col="${CSS.escape(point.col)}"]`,
    )
    if (!root || !cell) return
    const bounds = measureGrid(root)
    const box = cell.getBoundingClientRect()
    root.scrollTop += revealDelta(
      box.top,
      box.bottom,
      bounds.bodyTop,
      bounds.bottom,
    )
    if (!cell.dataset.gridPin)
      root.scrollLeft += revealDelta(
        box.left,
        box.right,
        bounds.centerLeft,
        bounds.centerRight,
      )
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget.querySelector("[role=grid]"))
      return
    if (event.key === "Escape") {
      event.preventDefault()
      keys.current = null
      finish(false)
      onChange(null)
      return
    }
    // Pointer modifiers and the initial selection are fixed for the gesture.
    if (drag.current) return
    const ctrl = event.ctrlKey || event.metaKey
    if (ctrl && event.key.toLowerCase() === "a") {
      event.preventDefault()
      keys.current = null
      const point = { row: 0, col: columns[0] }
      const gesture = beginSelection(null, point, "all", data.length, columns, {
        shift: false,
        ctrl: false,
      })
      if (gesture) onChange(updateSelection(gesture, point))
      return
    }
    if (
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return
    event.preventDefault()
    const current = keys.current?.expected ?? value
    const point = movePosition(
      current?.active,
      {
        row: event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0,
        col:
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0,
      },
      data.length,
      columns,
      ctrl,
    )
    if (!point) return
    const session = keys.current
    const gesture =
      event.shiftKey && session?.shift && session.ctrl === ctrl
        ? session.gesture
        : beginSelection(current, point, "cells", data.length, columns, {
            shift: event.shiftKey,
            ctrl: ctrl && event.shiftKey,
          })
    if (!gesture) return
    const next = updateSelection(gesture, point)
    keys.current = {
      gesture,
      data,
      columnKey,
      ctrl,
      shift: event.shiftKey,
      expected: next,
    }
    onChange(next)
    reveal(point)
  }

  return {
    ref,
    value,
    handlers: {
      onPointerDown,
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        current.x = event.clientX
        current.y = event.clientY
        current.moved ||=
          Math.hypot(current.x - current.startX, current.y - current.startY) >=
          3
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        current.x = event.clientX
        current.y = event.clientY
        current.moved ||=
          Math.hypot(current.x - current.startX, current.y - current.startY) >=
          3
        updateDrag(false)
        finish(true)
      },
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
      onBlur: () => {
        keys.current = null
        finish(false)
      },
      onKeyDown,
      onKeyUp: (event: KeyboardEvent<HTMLDivElement>) => {
        if (["Shift", "Control", "Meta"].includes(event.key))
          keys.current = null
      },
    },
  }
}
