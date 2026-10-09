import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  selectedCompletion,
} from "@codemirror/autocomplete"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  insertBlankLine,
} from "@codemirror/commands"
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language"
import {
  closeSearchPanel,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search"
import {
  Annotation,
  countColumn,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type StateCommand,
} from "@codemirror/state"
import {
  type Command,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"

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

// Explicit setup lets Alt+click add cursors without the default Alt-drag handler.
export const editorSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  EditorState.tabSize.of(2),
  indentUnit.of("  "),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  EditorView.clickAddsSelectionRange.of(
    (event) => event.altKey && !event.shiftKey,
  ),
  rectangularSelection({
    eventFilter: (event) =>
      event.button === 0 && event.altKey && event.shiftKey,
  }),
  highlightActiveLine(),
  highlightSelectionMatches(),
  editorShortcuts,
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
  ]),
]

// Only controlled value updates may replace a read-only document.
export const externalUpdate = Annotation.define<boolean>()

export function createEditorMode(
  readOnly: boolean,
  actions: { onRun?: () => void; onFormat?: () => void },
): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      "aria-readonly": String(readOnly),
      ...(readOnly ? { tabindex: "0" } : {}),
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (
          event.key !== "F5" ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        )
          return false
        if (!readOnly && view.hasFocus && !event.repeat && !event.isComposing)
          actions.onRun?.()
        // Suppress the browser reload even when execution is unavailable.
        event.preventDefault()
        return true
      },
    }),
    readOnly
      ? EditorState.transactionFilter.of((transaction) =>
          transaction.docChanged && !transaction.annotation(externalUpdate)
            ? []
            : transaction,
        )
      : keymap.of([
          ...(actions.onFormat
            ? [
                {
                  key: "Shift-Alt-f",
                  run: () => {
                    actions.onFormat?.()
                    return true
                  },
                },
              ]
            : []),
        ]),
  ]
}
