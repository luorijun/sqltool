import { MySQL, PostgreSQL, SQLite, sql } from "@codemirror/lang-sql"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search"
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { DbDriver } from "@/lib/config"
import type { TabEditorData, TabEditorSelection } from "@/lib/tabs"

export interface CursorPosition {
  line: number
  col: number
}

export interface EditorSelectionStats {
  selectedChars: number
  selectedLines: number
}

export interface SqlEditorHandle {
  focus: () => void
  openSearch: () => void
}

interface SqlEditorProps {
  value: string
  driver?: DbDriver
  editorState: TabEditorData
  onChange: (value: string) => void
  onEditorStateChange: (editorState: TabEditorData) => void
  onRun: () => void
  onFormat: () => void
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
  ".cm-panels": {
    backgroundColor: "color-mix(in oklab, var(--background) 92%, var(--muted))",
    borderBottom: "1px solid var(--border)",
    color: "var(--foreground)",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panel.cm-search": {
    padding: "6px 8px",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    fontSize: "0.6875rem",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    height: "24px",
    margin: 0,
    borderRadius: "9999px",
    padding: "0 8px",
    backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)",
    color: "var(--muted-foreground)",
  },
  ".cm-search input": {
    margin: 0,
  },
  ".cm-search .cm-textfield": {
    height: "24px",
    minWidth: "156px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--background)",
    padding: "0 9px",
    fontSize: "0.6875rem",
    color: "var(--foreground)",
    outline: "none",
  },
  ".cm-search .cm-textfield:focus": {
    borderColor: "var(--ring)",
    boxShadow: "0 0 0 3px color-mix(in oklab, var(--ring) 18%, transparent)",
  },
  ".cm-search button": {
    height: "24px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "color-mix(in oklab, var(--background) 86%, var(--muted))",
    padding: "0 8px",
    fontSize: "0.6875rem",
    color: "var(--foreground)",
    cursor: "pointer",
  },
  ".cm-search button:hover": {
    backgroundColor: "color-mix(in oklab, var(--background) 76%, var(--muted))",
  },
  ".cm-search button[aria-pressed='true']": {
    borderColor: "color-mix(in oklab, var(--primary) 24%, var(--border))",
    backgroundColor:
      "color-mix(in oklab, var(--primary) 9%, var(--background))",
  },
  ".cm-search [name='close']": {
    position: "static",
    minWidth: "24px",
    padding: 0,
    fontSize: "0.875rem",
    lineHeight: 1,
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--chart-4) 22%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
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
  if (!driver) {
    return []
  }

  switch (driver) {
    case "mysql":
      return sql({ dialect: MySQL })
    case "sqlite":
      return sql({ dialect: SQLite })
  }

  return sql({ dialect: PostgreSQL })
}

function getCursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)

  return {
    line: line.number,
    col: head - line.from + 1,
  }
}

function toSelectionRanges(selections: TabEditorSelection[]): EditorSelection {
  if (selections.length === 0) {
    return EditorSelection.single(0)
  }

  return EditorSelection.create(
    selections.map(({ anchor, head }) => EditorSelection.range(anchor, head)),
  )
}

function clampSelection(
  selection: TabEditorSelection,
  length: number,
): TabEditorSelection {
  return {
    anchor: Math.min(Math.max(selection.anchor, 0), length),
    head: Math.min(Math.max(selection.head, 0), length),
  }
}

function getSelectionStats(state: EditorState): EditorSelectionStats {
  let selectedChars = 0
  const selectedLines = new Set<number>()

  for (const range of state.selection.ranges) {
    if (range.empty) {
      continue
    }

    selectedChars += Math.abs(range.to - range.from)

    const firstLine = state.doc.lineAt(range.from).number
    const lastPos = Math.max(range.to - 1, range.from)
    const lastLine = state.doc.lineAt(lastPos).number

    for (let line = firstLine; line <= lastLine; line += 1) {
      selectedLines.add(line)
    }
  }

  return {
    selectedChars,
    selectedLines: selectedLines.size,
  }
}

function getSelectionRanges(
  selections: TabEditorSelection[],
  length: number,
): TabEditorSelection[] {
  if (selections.length === 0) {
    return [{ anchor: 0, head: 0 }]
  }

  return selections.map((selection) => clampSelection(selection, length))
}

function getEditorSnapshot(
  state: EditorState,
  view: EditorView,
): TabEditorData {
  const query = getSearchQuery(state)

  return {
    cursor: getCursorPosition(state),
    selections: state.selection.ranges.map((range) => ({
      anchor: range.anchor,
      head: range.head,
    })),
    mainSelectionIndex: state.selection.mainIndex,
    scroll: {
      top: view.scrollDOM.scrollTop,
      left: view.scrollDOM.scrollLeft,
    },
    search: {
      query: query.search,
      replace: query.replace,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      open: searchPanelOpen(state),
    },
  }
}

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    {
      value,
      driver,
      editorState,
      onChange,
      onEditorStateChange,
      onRun,
      onFormat,
    },
    ref,
  ) {
    const viewRef = useRef<EditorView | null>(null)
    const languageRef = useRef<Compartment | null>(null)
    const applyingExternalChangeRef = useRef(false)
    const syncingSnapshotRef = useRef(false)
    const initialValueRef = useRef(value)
    const initialDriverRef = useRef(driver)
    const initialEditorStateRef = useRef(editorState)
    const [host, setHost] = useState<HTMLDivElement | null>(null)

    initialValueRef.current = value
    initialDriverRef.current = driver
    initialEditorStateRef.current = editorState

    const handleChange = useEffectEvent((nextValue: string) => {
      onChange(nextValue)
    })

    const handleEditorStateChange = useEffectEvent(
      (nextEditorState: TabEditorData) => {
        onEditorStateChange(nextEditorState)
      },
    )

    const handleRun = useEffectEvent(() => {
      onRun()
    })

    const handleFormat = useEffectEvent(() => {
      onFormat()
    })

    const setHostRef = useCallback((node: HTMLDivElement | null) => {
      setHost(node)
    }, [])

    useImperativeHandle(ref, () => ({
      focus() {
        viewRef.current?.focus()
      },
      openSearch() {
        const view = viewRef.current
        if (!view) {
          return
        }

        openSearchPanel(view)
      },
    }))

    useLayoutEffect(() => {
      if (!host) {
        return
      }

      const language = new Compartment()
      languageRef.current = language

      const initialRanges = getSelectionRanges(
        initialEditorStateRef.current.selections,
        initialValueRef.current.length,
      )
      const initialSelection = toSelectionRanges(initialRanges)

      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: initialValueRef.current,
          selection: EditorSelection.create(
            initialSelection.ranges,
            Math.min(
              initialEditorStateRef.current.mainSelectionIndex,
              Math.max(0, initialSelection.ranges.length - 1),
            ),
          ),
          extensions: [
            basicSetup,
            search({ top: true }),
            language.of(getSqlExtension(initialDriverRef.current)),
            sqlEditorTheme,
            syntaxHighlighting(sqlHighlightStyle),
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  handleRun()
                  return true
                },
              },
              {
                key: "Shift-Alt-f",
                run: () => {
                  handleFormat()
                  return true
                },
              },
            ]),
            EditorView.contentAttributes.of({
              spellcheck: "false",
              autocorrect: "off",
              autocapitalize: "off",
              "aria-label": "SQL editor",
            }),
            EditorView.updateListener.of((update) => {
              if (syncingSnapshotRef.current) {
                return
              }

              if (update.docChanged && !applyingExternalChangeRef.current) {
                handleChange(update.state.doc.toString())
              }

              if (
                update.docChanged ||
                update.selectionSet ||
                update.viewportChanged ||
                update.transactions.some(
                  (transaction) => transaction.effects.length > 0,
                )
              ) {
                handleEditorStateChange(
                  getEditorSnapshot(update.state, update.view),
                )
              }
            }),
          ],
        }),
      })

      const handleScroll = () => {
        if (syncingSnapshotRef.current) {
          return
        }

        handleEditorStateChange(getEditorSnapshot(view.state, view))
      }

      view.scrollDOM.addEventListener("scroll", handleScroll)
      viewRef.current = view

      const initialSearch = initialEditorStateRef.current.search
      if (
        initialSearch.query ||
        initialSearch.replace ||
        initialSearch.caseSensitive ||
        initialSearch.wholeWord ||
        initialSearch.regexp
      ) {
        syncingSnapshotRef.current = true
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: initialSearch.query,
              replace: initialSearch.replace,
              caseSensitive: initialSearch.caseSensitive,
              wholeWord: initialSearch.wholeWord,
              regexp: initialSearch.regexp,
            }),
          ),
        })
        syncingSnapshotRef.current = false
      }

      if (initialSearch.open) {
        syncingSnapshotRef.current = true
        openSearchPanel(view)
        syncingSnapshotRef.current = false
      }

      view.scrollDOM.scrollTop = initialEditorStateRef.current.scroll.top
      view.scrollDOM.scrollLeft = initialEditorStateRef.current.scroll.left
      handleEditorStateChange(getEditorSnapshot(view.state, view))

      return () => {
        const snapshotView = viewRef.current
        if (snapshotView) {
          handleEditorStateChange(
            getEditorSnapshot(snapshotView.state, snapshotView),
          )
        }

        view.scrollDOM.removeEventListener("scroll", handleScroll)
        languageRef.current = null
        viewRef.current = null
        view.destroy()
      }
    }, [host])

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

      const selectionRanges = view.state.selection.ranges.map((range) => ({
        anchor: range.anchor,
        head: range.head,
      }))
      const nextRanges = getSelectionRanges(selectionRanges, value.length)
      const nextSelection = EditorSelection.create(
        nextRanges.map((selection) =>
          EditorSelection.range(selection.anchor, selection.head),
        ),
        Math.min(
          view.state.selection.mainIndex,
          Math.max(0, nextRanges.length - 1),
        ),
      )

      applyingExternalChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
        selection: nextSelection,
      })
      applyingExternalChangeRef.current = false
    }, [value])

    useEffect(() => {
      const view = viewRef.current
      if (!view) {
        return
      }

      const docLength = view.state.doc.length
      const clampedSelections = getSelectionRanges(
        editorState.selections,
        docLength,
      )
      const nextSelection = EditorSelection.create(
        clampedSelections.map((selection) =>
          EditorSelection.range(selection.anchor, selection.head),
        ),
        Math.min(
          editorState.mainSelectionIndex,
          Math.max(0, clampedSelections.length - 1),
        ),
      )
      const currentSelection = view.state.selection
      const selectionChanged = !currentSelection.eq(nextSelection)

      const currentQuery = getSearchQuery(view.state)
      const searchChanged =
        currentQuery.search !== editorState.search.query ||
        currentQuery.replace !== editorState.search.replace ||
        currentQuery.caseSensitive !== editorState.search.caseSensitive ||
        currentQuery.wholeWord !== editorState.search.wholeWord ||
        currentQuery.regexp !== editorState.search.regexp

      const panelOpen = searchPanelOpen(view.state)
      const panelChanged = panelOpen !== editorState.search.open

      const scrollChanged =
        Math.abs(view.scrollDOM.scrollTop - editorState.scroll.top) > 1 ||
        Math.abs(view.scrollDOM.scrollLeft - editorState.scroll.left) > 1

      if (
        !selectionChanged &&
        !searchChanged &&
        !panelChanged &&
        !scrollChanged
      ) {
        return
      }

      syncingSnapshotRef.current = true

      if (selectionChanged) {
        view.dispatch({ selection: nextSelection })
      }

      if (searchChanged) {
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: editorState.search.query,
              replace: editorState.search.replace,
              caseSensitive: editorState.search.caseSensitive,
              wholeWord: editorState.search.wholeWord,
              regexp: editorState.search.regexp,
            }),
          ),
        })
      }

      if (panelChanged) {
        if (editorState.search.open) {
          openSearchPanel(view)
        } else {
          closeSearchPanel(view)
        }
      }

      if (scrollChanged) {
        view.scrollDOM.scrollTop = editorState.scroll.top
        view.scrollDOM.scrollLeft = editorState.scroll.left
      }

      syncingSnapshotRef.current = false
    }, [editorState])

    return <div ref={setHostRef} className="size-full min-w-0 min-h-0" />
  },
)

export { SqlEditor, getSelectionStats }
