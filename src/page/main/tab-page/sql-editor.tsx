import { MySQL, PostgreSQL, SQLite, sql } from "@codemirror/lang-sql"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { useEffect, useRef } from "react"
import type { DbDriver } from "@/lib/config"

export interface CursorPosition {
  line: number
  col: number
}

interface SqlEditorProps {
  value: string
  driver?: DbDriver
  onChange: (value: string) => void
  onCursorChange: (cursor: CursorPosition) => void
}

const MONO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const sqlHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.definitionKeyword, tags.operatorKeyword],
    color: "var(--primary)",
    fontWeight: "600",
  },
  {
    tag: [tags.string],
    color: "var(--chart-2)",
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null],
    color: "var(--chart-3)",
  },
  {
    tag: [tags.typeName, tags.className],
    color: "var(--chart-4)",
  },
  {
    tag: [tags.comment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
])

const sqlEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "0.875rem",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: MONO_FONT_FAMILY,
    lineHeight: "20px",
  },
  ".cm-content": {
    minHeight: "100%",
    caretColor: "var(--foreground)",
    padding: "0",
  },
  ".cm-line": {
    padding: "0 12px",
    tabSize: "2",
  },
  ".cm-gutters": {
    minHeight: "100%",
    borderRight: "1px solid var(--border)",
    backgroundColor: "color-mix(in oklab, var(--muted) 20%, transparent)",
    color: "var(--muted-foreground)",
  },
  ".cm-gutterElement": {
    minWidth: "2.75rem",
    padding: "0 8px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-selectionBackground": {
    backgroundColor:
      "color-mix(in oklab, var(--primary) 22%, transparent) !important",
  },
  ".cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
  },
})

function getSqlExtension(driver?: DbDriver): Extension {
  switch (driver) {
    case "mysql":
      return sql({ dialect: MySQL })
    case "sqlite":
      return sql({ dialect: SQLite })
    default:
      return sql({ dialect: PostgreSQL })
  }
}

function getCursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)

  return {
    line: line.number,
    col: head - line.from + 1,
  }
}

export function SqlEditor({
  value,
  driver,
  onChange,
  onCursorChange,
}: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef<Compartment | null>(null)
  const applyingExternalChangeRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onCursorChangeRef.current = onCursorChange
  }, [onCursorChange])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const language = new Compartment()
    languageRef.current = language

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          language.of(getSqlExtension(driver)),
          sqlEditorTheme,
          syntaxHighlighting(sqlHighlightStyle),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            "aria-label": "SQL editor",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternalChangeRef.current) {
              onChangeRef.current(update.state.doc.toString())
            }

            if (update.docChanged || update.selectionSet) {
              onCursorChangeRef.current(getCursorPosition(update.state))
            }
          }),
        ],
      }),
    })

    viewRef.current = view
    onCursorChangeRef.current(getCursorPosition(view.state))

    return () => {
      languageRef.current = null
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const language = languageRef.current
    if (!view || !language) {
      return
    }

    view.dispatch({
      effects: language.reconfigure(getSqlExtension(driver)),
    })
  }, [driver])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (value === currentValue) {
      return
    }

    const selection = view.state.selection.main
    const nextHead = Math.min(selection.head, value.length)

    // External SQL changes should update the editor without bouncing back through React.
    applyingExternalChangeRef.current = true
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: EditorSelection.cursor(nextHead),
    })
    applyingExternalChangeRef.current = false
  }, [value])

  return <div ref={hostRef} className="size-full min-w-0 min-h-0" />
}
