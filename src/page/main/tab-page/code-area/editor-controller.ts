import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql"
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
import type { DbDriver } from "@/lib/conn"
import type { TabEditorState } from "@/lib/tabs"

export interface CursorPosition {
  line: number
  col: number
}

export interface EditorSelectionStats {
  selectedChars: number
  selectedLines: number
}

interface CreateSqlEditorControllerOptions {
  host: HTMLDivElement
  value: string
  driver?: DbDriver
  editorState: TabEditorState
  onChange: (value: string) => void
  onEditorStateChange: (editorState: TabEditorState) => void
  onRun: () => void
  onFormat: () => void
}

export interface SqlEditorController {
  destroy: () => void
  focus: () => void
  openSearch: () => void
  setDriver: (driver?: DbDriver) => void
  setValue: (value: string) => void
  syncViewState: (editorState: TabEditorState) => void
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

function toSelectionRanges(
  selections: TabEditorState["selections"],
): EditorSelection {
  if (selections.length === 0) {
    return EditorSelection.single(0)
  }

  return EditorSelection.create(
    selections.map(({ anchor, head }) => EditorSelection.range(anchor, head)),
  )
}

function clampSelection(
  selection: TabEditorState["selections"][number],
  length: number,
): TabEditorState["selections"][number] {
  return {
    anchor: Math.min(Math.max(selection.anchor, 0), length),
    head: Math.min(Math.max(selection.head, 0), length),
  }
}

export function getSelectionStats(state: EditorState): EditorSelectionStats {
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
  selections: TabEditorState["selections"],
  length: number,
): TabEditorState["selections"] {
  if (selections.length === 0) {
    return [{ anchor: 0, head: 0 }]
  }

  return selections.map((selection) => clampSelection(selection, length))
}

function getEditorSnapshot(
  state: EditorState,
  view: EditorView,
): TabEditorState {
  const query = getSearchQuery(state)

  return {
    status: "idle",
    text: state.doc.toString(),
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

export function createSqlEditorController(
  options: CreateSqlEditorControllerOptions,
): SqlEditorController {
  const language = new Compartment()
  let currentDriver = options.driver
  let destroyed = false
  let applyingExternalChange = false
  let syncingSnapshot = false

  const initialRanges = getSelectionRanges(
    options.editorState.selections,
    options.value.length,
  )
  const initialSelection = toSelectionRanges(initialRanges)

  const view = new EditorView({
    parent: options.host,
    state: EditorState.create({
      doc: options.value,
      selection: EditorSelection.create(
        initialSelection.ranges,
        Math.min(
          options.editorState.mainSelectionIndex,
          Math.max(0, initialSelection.ranges.length - 1),
        ),
      ),
      extensions: [
        basicSetup,
        search({ top: true }),
        language.of(getSqlExtension(options.driver)),
        sqlEditorTheme,
        syntaxHighlighting(sqlHighlightStyle),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              options.onRun()
              return true
            },
          },
          {
            key: "Shift-Alt-f",
            run: () => {
              options.onFormat()
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
          if (syncingSnapshot) {
            return
          }

          if (update.docChanged && !applyingExternalChange) {
            options.onChange(update.state.doc.toString())
          }

          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.transactions.some(
              (transaction) => transaction.effects.length > 0,
            )
          ) {
            options.onEditorStateChange(
              getEditorSnapshot(update.state, update.view),
            )
          }
        }),
      ],
    }),
  })

  const handleScroll = () => {
    if (syncingSnapshot) {
      return
    }

    options.onEditorStateChange(getEditorSnapshot(view.state, view))
  }

  view.scrollDOM.addEventListener("scroll", handleScroll)

  const initialSearch = options.editorState.search
  if (
    initialSearch.query ||
    initialSearch.replace ||
    initialSearch.caseSensitive ||
    initialSearch.wholeWord ||
    initialSearch.regexp
  ) {
    syncingSnapshot = true
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
    syncingSnapshot = false
  }

  if (initialSearch.open) {
    syncingSnapshot = true
    openSearchPanel(view)
    syncingSnapshot = false
  }

  view.scrollDOM.scrollTop = options.editorState.scroll.top
  view.scrollDOM.scrollLeft = options.editorState.scroll.left
  options.onEditorStateChange(getEditorSnapshot(view.state, view))

  return {
    destroy() {
      if (destroyed) {
        return
      }

      destroyed = true
      view.scrollDOM.removeEventListener("scroll", handleScroll)
      view.destroy()
    },
    focus() {
      if (destroyed) {
        return
      }

      view.focus()
    },
    openSearch() {
      if (destroyed) {
        return
      }

      openSearchPanel(view)
    },
    setDriver(driver) {
      if (destroyed || Object.is(currentDriver, driver)) {
        return
      }

      currentDriver = driver
      view.dispatch({
        effects: language.reconfigure(getSqlExtension(driver)),
      })
    },
    setValue(value) {
      if (destroyed) {
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

      applyingExternalChange = true
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
        selection: nextSelection,
      })
      applyingExternalChange = false
    },
    syncViewState(editorState) {
      if (destroyed) {
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

      syncingSnapshot = true

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

      syncingSnapshot = false
    },
  }
}
