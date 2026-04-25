import { useAtomValue, useSetAtom } from "jotai"
import { AlignLeft, Play, Search } from "lucide-react"
import { useMemo, useRef } from "react"
import { toast } from "sonner"
import type { SqlLanguage } from "sql-formatter"
import { format as formatSql } from "sql-formatter"
import { Button } from "@/components/ui/button"
import type { DbDriver } from "@/lib/config"
import type { TabEditorData } from "@/lib/tabs"
import {
  activeTabConnectionAtom,
  activeTabEditorStateAtom,
  activeTabIdAtom,
  activeTabResultAtom,
  activeTabSqlAtom,
  runActiveTabSqlAtom,
  updateActiveSqlAtom,
  updateTabEditorStateAtom,
} from "@/lib/tabs/renderer"
import { AreaStatusBar, AreaToolbar } from "./bars"
import { SqlEditor, type SqlEditorHandle } from "./sql-editor"

const FORMAT_LANGUAGE_MAP: Record<DbDriver, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
}

const DEFAULT_FORMAT_LANGUAGE: SqlLanguage = "sql"

function getLineCount(sql: string): number {
  return sql ? sql.split("\n").length : 1
}

function getLineNumberAt(sql: string, pos: number): number {
  let line = 1
  const end = Math.min(Math.max(pos, 0), sql.length)

  for (let index = 0; index < end; index += 1) {
    if (sql[index] === "\n") {
      line += 1
    }
  }

  return line
}

function getEditorSummary(editorState: TabEditorData, sql: string) {
  let selectedChars = 0
  const selectedLines = new Set<number>()

  for (const selection of editorState.selections) {
    const start = Math.min(selection.anchor, selection.head)
    const end = Math.max(selection.anchor, selection.head)

    if (start === end) {
      continue
    }

    selectedChars += end - start

    const firstLine = getLineNumberAt(sql, start)
    const lastLine = getLineNumberAt(sql, Math.max(end - 1, start))

    for (let line = firstLine; line <= lastLine; line += 1) {
      selectedLines.add(line)
    }
  }

  return {
    lineCount: getLineCount(sql),
    selectedChars,
    selectedLines: selectedLines.size,
  }
}

function isSameEditorState(left: TabEditorData, right: TabEditorData): boolean {
  return (
    left.cursor.line === right.cursor.line &&
    left.cursor.col === right.cursor.col &&
    left.mainSelectionIndex === right.mainSelectionIndex &&
    left.scroll.top === right.scroll.top &&
    left.scroll.left === right.scroll.left &&
    left.search.query === right.search.query &&
    left.search.replace === right.search.replace &&
    left.search.caseSensitive === right.search.caseSensitive &&
    left.search.wholeWord === right.search.wholeWord &&
    left.search.regexp === right.search.regexp &&
    left.search.open === right.search.open &&
    left.selections.length === right.selections.length &&
    left.selections.every(
      (selection, index) =>
        selection.anchor === right.selections[index]?.anchor &&
        selection.head === right.selections[index]?.head,
    )
  )
}

export function CodeArea() {
  const activeTabId = useAtomValue(activeTabIdAtom)
  const connection = useAtomValue(activeTabConnectionAtom)
  const editorState = useAtomValue(activeTabEditorStateAtom)
  const result = useAtomValue(activeTabResultAtom)
  const sql = useAtomValue(activeTabSqlAtom)
  const updateSql = useSetAtom(updateActiveSqlAtom)
  const runSql = useSetAtom(runActiveTabSqlAtom)
  const updateTabEditorState = useSetAtom(updateTabEditorStateAtom)
  const editorRef = useRef<SqlEditorHandle | null>(null)

  const summary = useMemo(() => {
    if (!editorState) {
      return {
        lineCount: 1,
        selectedChars: 0,
        selectedLines: 0,
      }
    }

    return getEditorSummary(editorState, sql)
  }, [editorState, sql])

  if (!activeTabId || !editorState) {
    return <div className="size-full" />
  }

  const handleEditorStateChange = (nextEditorState: TabEditorData) => {
    updateTabEditorState({
      tabId: activeTabId,
      updater: (current) => {
        if (isSameEditorState(current, nextEditorState)) {
          return current
        }

        return {
          ...current,
          cursor: nextEditorState.cursor,
          selections: nextEditorState.selections,
          mainSelectionIndex: nextEditorState.mainSelectionIndex,
          scroll: nextEditorState.scroll,
          search: nextEditorState.search,
        }
      },
    })
  }

  const handleFormat = () => {
    if (!sql.trim()) {
      return
    }

    try {
      const formatted = formatSql(sql, {
        language: connection?.driver
          ? FORMAT_LANGUAGE_MAP[connection.driver]
          : DEFAULT_FORMAT_LANGUAGE,
        tabWidth: 2,
        keywordCase: "upper",
      })

      if (formatted !== sql) {
        updateSql(formatted)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SQL 格式化失败")
    }
  }

  return (
    <div className="size-full flex flex-col overflow-hidden">
      <AreaToolbar>
        <Button
          variant="default"
          size="xs"
          className="gap-1.5"
          onClick={() => runSql()}
          disabled={result?.running}
          title="运行 SQL (Ctrl/Cmd + Enter)"
        >
          <Play className="size-3" />
          运行
        </Button>

        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          onClick={handleFormat}
          title="格式化 SQL (Shift + Alt + F)"
        >
          <AlignLeft className="size-3" />
          格式化
        </Button>

        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          onClick={() => editorRef.current?.openSearch()}
          title="搜索 (Ctrl/Cmd + F)"
        >
          <Search className="size-3" />
          搜索
        </Button>
      </AreaToolbar>

      <AreaStatusBar className="px-3 text-[11px]">
        <span>{summary.lineCount} 行</span>
        <span>
          第 {editorState.cursor.line} 行，第 {editorState.cursor.col} 列
        </span>
        <span>{summary.selectedChars} 个已选字符</span>
        <span>{summary.selectedLines} 个已选行</span>
        {!connection && <span>未绑定连接，当前为纯文本模式</span>}
      </AreaStatusBar>

      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={activeTabId}
          ref={editorRef}
          value={sql}
          driver={connection?.driver}
          editorState={editorState}
          onChange={updateSql}
          onEditorStateChange={handleEditorStateChange}
          onRun={() => runSql()}
          onFormat={handleFormat}
        />
      </div>
    </div>
  )
}
