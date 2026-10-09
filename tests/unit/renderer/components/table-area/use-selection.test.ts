import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { createElement, type PointerEvent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { useSelection } from "@/renderer/components/table-area/use-selection"

class Cell {
  dataset = { gridRow: "0", gridCol: "name" }
  captured = new Set<number>()
  closest(selector: string) {
    return selector === "[data-grid-row][data-grid-col]" ? this : null
  }
  setPointerCapture = mock((id: number) => {
    this.captured.add(id)
  })
  hasPointerCapture(id: number) {
    return this.captured.has(id)
  }
  releasePointerCapture = mock((id: number) => {
    this.captured.delete(id)
  })
}

const globals = new Map<string, PropertyDescriptor | undefined>()

beforeEach(() => {
  for (const [key, value] of Object.entries({
    Element: Cell,
    requestAnimationFrame: (): number => 1,
    cancelAnimationFrame: () => {},
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
})

afterEach(() => {
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  globals.clear()
})

function fixture() {
  const cell = new Cell()
  const root = {
    contains: (node: unknown) => node === cell,
    querySelector: () => ({ focus: () => {} }),
    setPointerCapture: mock(() => {}),
    hasPointerCapture: () => false,
    releasePointerCapture: mock(() => {}),
  }
  const onChange = mock(() => {})
  let selection!: ReturnType<typeof useSelection>
  function Probe() {
    selection = useSelection({
      selection: null,
      onChange,
      data: [{}],
      columns: ["name"],
    })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  selection.ref.current = root as unknown as HTMLDivElement
  const event = {
    target: cell,
    currentTarget: root,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 20,
    clientY: 30,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {},
  } as unknown as PointerEvent<HTMLDivElement>
  return { cell, root, onChange, handlers: selection.handlers, event }
}

test("pointer capture stays on the pressed cell so double-clicks can reach it", () => {
  const { cell, root, onChange, handlers, event } = fixture()

  for (let i = 0; i < 2; i++) {
    handlers.onPointerDown(event)
    expect(cell.hasPointerCapture(event.pointerId)).toBe(true)
    expect(root.setPointerCapture).not.toHaveBeenCalled()

    handlers.onPointerUp(event)
    expect(cell.hasPointerCapture(event.pointerId)).toBe(false)
  }

  expect(cell.setPointerCapture).toHaveBeenCalledTimes(2)
  expect(cell.releasePointerCapture).toHaveBeenCalledTimes(2)
  expect(onChange).toHaveBeenCalledTimes(2)
})

test("cancelling a selection releases capture from the cell without committing it", () => {
  const { cell, root, onChange, handlers, event } = fixture()

  handlers.onPointerDown(event)
  handlers.onPointerCancel()

  expect(cell.hasPointerCapture(event.pointerId)).toBe(false)
  expect(cell.releasePointerCapture).toHaveBeenCalledWith(event.pointerId)
  expect(root.releasePointerCapture).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

test("losing grid focus releases capture from the cell and permits a new gesture", () => {
  const { cell, onChange, handlers, event } = fixture()

  handlers.onPointerDown(event)
  handlers.onBlur()
  expect(cell.hasPointerCapture(event.pointerId)).toBe(false)
  expect(onChange).not.toHaveBeenCalled()

  handlers.onPointerDown(event)
  expect(cell.hasPointerCapture(event.pointerId)).toBe(true)
  handlers.onPointerUp(event)
  expect(cell.hasPointerCapture(event.pointerId)).toBe(false)
  expect(onChange).toHaveBeenCalledTimes(1)
})
