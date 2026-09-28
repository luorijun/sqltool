import { Annotation, EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"

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
    readOnly
      ? EditorState.transactionFilter.of((transaction) =>
          transaction.docChanged && !transaction.annotation(externalUpdate)
            ? []
            : transaction,
        )
      : keymap.of([
          ...(actions.onRun
            ? [
                {
                  key: "Mod-Enter",
                  run: () => {
                    actions.onRun?.()
                    return true
                  },
                },
              ]
            : []),
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
