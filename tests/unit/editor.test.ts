import { describe, expect, test } from "bun:test"
import {
  replaceAll,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { format } from "sql-formatter"
import {
  createEditorMode,
  externalUpdate,
} from "../../src/renderer/components/sql-editor/mode"

test.each(["postgresql", "mysql"] as const)(
  "%s formatting preserves literals and is stable on repeated formatting",
  (language) => {
    const sql =
      "select 'MiXeD  text; -- literal' as label, amount from items where amount between 1 and 10;"
    const options = { language, tabWidth: 2, keywordCase: "upper" as const }
    const formatted = format(sql, options)
    expect(formatted).toContain("SELECT")
    expect(formatted).toContain("'MiXeD  text; -- literal'")
    expect(formatted).toContain("BETWEEN 1 AND 10")
    expect(format(formatted, options)).toBe(formatted)
  },
)

describe("SQL editor read-only mode", () => {
  test("blocks document edits but accepts controlled SQL updates and selection", () => {
    const state = EditorState.create({
      doc: "SELECT 1",
      extensions: [createEditorMode(true, {})],
    })
    expect(state.readOnly).toBe(true)
    expect(state.facet(EditorView.editable)).toBe(false)
    for (const userEvent of [
      "input.type",
      "input.paste",
      "delete.cut",
      "undo",
    ]) {
      const next = state.update({
        changes: { from: 0, to: 8, insert: "DELETE" },
        userEvent,
      }).state
      expect(next.doc.toString()).toBe("SELECT 1")
    }
    const next = state.update({
      changes: { from: 0, to: 8, insert: "SELECT 2" },
      annotations: externalUpdate.of(true),
      selection: { anchor: 0, head: 6 },
    }).state
    expect(next.doc.toString()).toBe("SELECT 2")
    expect(next.selection.main.to).toBe(6)
  })

  test("allows searching while replace commands cannot modify SQL", () => {
    let state = EditorState.create({
      doc: "SELECT 1",
      extensions: [search(), createEditorMode(true, {})],
    })
    state = state.update({
      effects: setSearchQuery.of(
        new SearchQuery({ search: "1", replace: "2" }),
      ),
    }).state
    const view = {
      state,
      dispatch: () => {
        throw new Error("Read-only replace dispatched")
      },
    } as unknown as EditorView
    expect(replaceAll(view)).toBe(false)
    expect(state.doc.toString()).toBe("SELECT 1")
  })

  test("only editable mode registers run and format shortcuts", () => {
    let runs = 0
    let formats = 0
    const actions = {
      onRun: () => {
        runs++
      },
      onFormat: () => {
        formats++
      },
    }
    const readonly = EditorState.create({
      extensions: [createEditorMode(true, actions)],
    })
    const shortcuts = ["Mod-Enter", "Shift-Alt-f"]
    expect(
      readonly
        .facet(keymap)
        .flat()
        .filter((binding) => shortcuts.includes(binding.key ?? "")),
    ).toEqual([])
    const editable = EditorState.create({
      extensions: [createEditorMode(false, actions)],
    })
    const bindings = editable.facet(keymap).flat()
    expect(bindings.map((binding) => binding.key)).toEqual(shortcuts)
    for (const key of shortcuts)
      bindings.find((binding) => binding.key === key)?.run?.({} as EditorView)
    expect(runs).toBe(1)
    expect(formats).toBe(1)
    const noActions = EditorState.create({
      extensions: [createEditorMode(false, {})],
    })
    expect(noActions.facet(keymap).flat()).toEqual([])
  })

  test("switching modes changes editing behavior without replacing the document", () => {
    const mode = new Compartment()
    let state = EditorState.create({
      doc: "SELECT 1",
      extensions: [mode.of(createEditorMode(false, {}))],
    })
    state = state.update({
      effects: mode.reconfigure(createEditorMode(true, {})),
    }).state
    state = state.update({
      changes: { from: 0, to: 8, insert: "blocked" },
    }).state
    expect(state.doc.toString()).toBe("SELECT 1")
    state = state.update({
      effects: mode.reconfigure(createEditorMode(false, {})),
    }).state
    state = state.update({
      changes: { from: 0, to: 8, insert: "SELECT 2" },
    }).state
    expect(state.doc.toString()).toBe("SELECT 2")
  })
})
