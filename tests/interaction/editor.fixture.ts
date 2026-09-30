import {
  autocompletion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { createEditorMode } from "../../src/renderer/components/sql-editor/mode"
import { editorSetup } from "../../src/renderer/components/sql-editor/setup"

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
}

async function runTests() {
  let runs = 0
  let formats = 0
  let view = new EditorView()
  function reset(doc = "one\ntwo\nthree", readOnly = false) {
    view?.destroy()
    document.body.replaceChildren()
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          editorSetup,
          autocompletion({
            override: [() => ({ from: 0, options: [{ label: "SELECT" }] })],
          }),
          createEditorMode(readOnly, {
            onRun: () => {
              runs++
            },
            onFormat: () => {
              formats++
            },
          }),
        ],
      }),
    })
    view.focus()
  }
  function press(
    key: string,
    options: KeyboardEventInit = {},
    target: Element = view.contentDOM,
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  function text() {
    return view.state.doc.toString()
  }
  reset()
  equal(press("F5"), true, "F5 prevents reload")
  equal(runs, 1, "F5 runs SQL")
  press("F5", { repeat: true })
  press("F5", { ctrlKey: true })
  press("F5", { isComposing: true })
  equal(runs, 1, "repeat, modified and composing F5 do not run")
  press("Enter", { ctrlKey: true })
  equal(text(), "one\n\ntwo\nthree", "Ctrl+Enter inserts below")
  equal(runs, 1, "Ctrl+Enter does not run")
  press("f", { shiftKey: true, altKey: true })
  equal(formats, 1, "format shortcut preserved")

  reset("  one\ntwo")
  press("Enter", { ctrlKey: true, shiftKey: true })
  equal(
    text(),
    "  \n  one\ntwo",
    "Ctrl+Shift+Enter inserts indented line above",
  )
  equal(view.state.selection.main.head, 2, "cursor on inserted line")
  press("z", { ctrlKey: true })
  equal(text(), "  one\ntwo", "line insertion undo")
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(3),
    ]),
  })
  press("Enter", { ctrlKey: true, shiftKey: true })
  equal(text(), "  \n  one\ntwo", "multiple cursors on same line insert once")

  reset("abc")
  view.dispatch({ selection: { anchor: 1 } })
  press("Tab")
  equal(text(), "a bc", "Tab advances to two-space stop")
  reset()
  view.dispatch({ selection: { anchor: 0, head: 7 } })
  press("Tab")
  equal(text(), "  one\n  two\nthree", "Tab indents selected lines")
  press("Tab", { shiftKey: true })
  equal(text(), "one\ntwo\nthree", "Shift+Tab outdents")
  view.dispatch({ selection: { anchor: 1 } })
  press("l", { ctrlKey: true })
  equal(
    [view.state.selection.main.from, view.state.selection.main.to],
    [0, 4],
    "Ctrl+L selects line",
  )
  press("l", { ctrlKey: true })
  equal(view.state.selection.main.to, 8, "Ctrl+L extends selection")

  reset()
  press("g", { ctrlKey: true })
  equal(
    document.activeElement?.getAttribute("name"),
    "line",
    "Ctrl+G focuses line input",
  )
  reset()
  press("h", { ctrlKey: true })
  equal(
    document.activeElement?.getAttribute("name"),
    "replace",
    "Ctrl+H focuses replace input",
  )
  press("F5", {}, document.activeElement as Element)
  equal(runs, 1, "F5 in search does not execute")
  press("Escape", {}, document.activeElement as Element)
  equal(!!view.dom.querySelector(".cm-search"), false, "Escape closes search")

  reset("S")
  view.dispatch({ selection: { anchor: 1 } })
  startCompletion(view)
  for (let i = 0; i < 50 && completionStatus(view.state) !== "active"; i++)
    await new Promise((resolve) => setTimeout(resolve, 20))
  equal(completionStatus(view.state), "active", "completion opened")
  await new Promise((resolve) => setTimeout(resolve, 100))
  press("Tab")
  equal(text(), "SELECT", "Tab accepts completion")
  reset()
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(4),
    ]),
  })
  press("f", { ctrlKey: true })
  view.focus()
  startCompletion(view)
  for (let i = 0; i < 50 && completionStatus(view.state) !== "active"; i++)
    await new Promise((resolve) => setTimeout(resolve, 20))
  await new Promise((resolve) => setTimeout(resolve, 100))
  press("Escape")
  equal(completionStatus(view.state), null, "Escape closes completion first")
  equal(
    !!view.dom.querySelector(".cm-search"),
    true,
    "search stays open after completion closes",
  )
  equal(
    view.state.selection.ranges.length,
    2,
    "cursors preserved after completion closes",
  )
  press("Escape")
  equal(
    !!view.dom.querySelector(".cm-search"),
    false,
    "second Escape closes search",
  )
  equal(view.state.selection.ranges.length, 2, "search close preserves cursors")
  press("Escape")
  equal(view.state.selection.ranges.length, 1, "third Escape reduces cursors")

  reset()
  const point = view.coordsAtPos(5)
  if (!point) throw new Error("Missing click coordinates")
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      altKey: true,
      clientX: point.left,
      clientY: (point.top + point.bottom) / 2,
    }),
  )
  document.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, button: 0 }),
  )
  equal(view.state.selection.ranges.length, 2, "Alt+click adds cursor")

  reset("SELECT 1", true)
  for (const [key, modifiers] of [
    ["F5", {}],
    ["Enter", { ctrlKey: true }],
    ["Enter", { ctrlKey: true, shiftKey: true }],
    ["Tab", {}],
    ["f", { altKey: true, shiftKey: true }],
  ] as const)
    press(key, modifiers)
  equal(text(), "SELECT 1", "read-only keyboard editing blocked")
  equal(runs, 1, "read-only F5 blocked")
  equal(formats, 1, "read-only formatting blocked")
  view.destroy()
  return "PASS: editor keyboard events, completion, selection, search focus, undo, F5 guards and read-only mode"
}

Object.assign(window, { runTests })
