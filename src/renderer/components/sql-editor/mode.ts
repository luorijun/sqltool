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
