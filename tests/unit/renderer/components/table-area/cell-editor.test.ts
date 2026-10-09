import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { QueryResultColumn } from "@/core/database"
import {
  CellEditor,
  focusEditor,
} from "@/renderer/components/table-area/cell-editor"

test.each(["", "existing text", "新输入😀"])(
  "text editors focus with a collapsed caret at the end of %j",
  (value) => {
    let active: unknown = null
    const control = {
      value,
      selectionStart: 0,
      selectionEnd: value.length,
      focus() {
        active = this
      },
      setSelectionRange(start: number, end: number) {
        expect(active).toBe(this)
        this.selectionStart = start
        this.selectionEnd = end
      },
    }

    focusEditor(control as HTMLInputElement | HTMLTextAreaElement)

    expect(active).toBe(control)
    expect(control.selectionStart).toBe(value.length)
    expect(control.selectionEnd).toBe(value.length)
    expect(control.value).toBe(value)
  },
)

test("boolean editors focus without attempting to set a text selection", () => {
  let active: unknown = null
  const control = {
    value: "false",
    focus() {
      active = this
    },
  }

  focusEditor(control as HTMLSelectElement)

  expect(active).toBe(control)
  expect(control.value).toBe("false")
})

test.each([
  { value: "original", initial: undefined, expected: "original" },
  { value: "original", initial: "新", expected: "新" },
  { value: null, initial: undefined, expected: "" },
])(
  "inline editors retain the initial text for %j",
  ({ value, initial, expected }) => {
    const column: QueryResultColumn = {
      id: "name",
      name: "Name",
      typeFamily: "string",
    }
    const html = renderToStaticMarkup(
      createElement(CellEditor, {
        value,
        column,
        initial,
        onCommit: () => {},
        onCancel: () => {},
      }),
    )

    expect(html).toContain('aria-label="编辑 Name"')
    expect(html).toContain(`value="${expected}"`)
  },
)
