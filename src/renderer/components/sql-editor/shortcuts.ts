import { acceptCompletion, selectedCompletion } from "@codemirror/autocomplete"
import { indentLess, indentMore, insertBlankLine } from "@codemirror/commands"
import { closeSearchPanel, gotoLine, openSearchPanel } from "@codemirror/search"
import {
  countColumn,
  EditorSelection,
  Prec,
  type StateCommand,
} from "@codemirror/state"
import { type Command, keymap } from "@codemirror/view"

export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const lines = state.selection.ranges.map((range) =>
    state.doc.lineAt(range.from),
  )
  const inserts = [
    ...new Map(lines.map((line) => [line.from, line])).values(),
  ].map((line) => ({
    from: line.from,
    insert: `${/^\s*/.exec(line.text)?.[0] ?? ""}\n`,
  }))
  const changes = state.changes(inserts)
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.create(
        lines.map((line) =>
          EditorSelection.cursor(
            changes.mapPos(line.from, -1) +
              (/^\s*/.exec(line.text)?.[0].length ?? 0),
          ),
        ),
        state.selection.mainIndex,
      ),
      scrollIntoView: true,
      userEvent: "input",
    }),
  )
  return true
}

export const selectWholeLine: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update({
      selection: EditorSelection.create(
        state.selection.ranges.map((range) => {
          const first = state.doc.lineAt(range.from)
          const last = state.doc.lineAt(range.to)
          return EditorSelection.range(
            first.from,
            Math.min(last.to + 1, state.doc.length),
          )
        }),
        state.selection.mainIndex,
      ),
      scrollIntoView: true,
      userEvent: "select",
    }),
  )
  return true
}

export const insertIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  if (
    state.selection.ranges.some(
      (range) =>
        state.doc.lineAt(range.from).number !==
        state.doc.lineAt(range.to).number,
    )
  ) {
    return indentMore({ state, dispatch })
  }
  const size = state.tabSize
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from)
        const column = countColumn(
          line.text.slice(0, range.from - line.from),
          size,
        )
        const insert = " ".repeat(size - (column % size))
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        }
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  )
  return true
}

const tab: Command = (view) => {
  if (view.state.readOnly) return false
  // A newly opened completion may still be inside its interaction delay.
  if (selectedCompletion(view.state)) {
    acceptCompletion(view)
    return true
  }
  return insertIndent(view)
}

const openReplace: Command = (view) => {
  openSearchPanel(view)
  view.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.select()
  return true
}

// Completion handlers have highest precedence; these override the generic defaults.
export const editorShortcuts = Prec.high(
  keymap.of([
    { key: "Mod-Enter", run: insertBlankLine },
    { key: "Mod-Shift-Enter", run: insertLineAbove },
    { key: "Tab", run: tab, shift: indentLess },
    { key: "Mod-l", run: selectWholeLine },
    { key: "Mod-g", run: gotoLine },
    { key: "Mod-h", run: openReplace, scope: "editor search-panel" },
    { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
  ]),
)
