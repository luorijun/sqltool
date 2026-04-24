import { useAtomValue, useSetAtom } from "jotai"
import { AlignLeft, Play, Search } from "lucide-react"
import { useMemo, useRef } from "react"
import { toast } from "sonner"
import type { SqlLanguage } from "sql-formatter"
import { format as formatSql } from "sql-formatter"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DbDriver } from "@/lib/config"
import type { TabEditorData } from "@/lib/tabs"
import {
  activeTabConnectionAtom,
  activeTabDialectAtom,
  activeTabEditorStateAtom,
  activeTabIdAtom,
  activeTabResultAtom,
  activeTabSqlAtom,
  runActiveTabSqlAtom,
  setActiveTabDialectOverrideAtom,
  updateActiveSqlAtom,
  updateTabEditorStateAtom,
} from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { SqlEditor, type SqlEditorHandle } from "./sql-editor"

const DIALECT_LABELS: Record<DbDriver, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
}

const FORMAT_LANGUAGE_MAP: Record<DbDriver, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
}

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
  const dialect = useAtomValue(activeTabDialectAtom)
  const sql = useAtomValue(activeTabSqlAtom)
  const updateSql = useSetAtom(updateActiveSqlAtom)
  const runSql = useSetAtom(runActiveTabSqlAtom)
  const setDialectOverride = useSetAtom(setActiveTabDialectOverrideAtom)
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
        language: FORMAT_LANGUAGE_MAP[dialect],
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
      <div className="flex-none flex items-center gap-1 px-2 h-9 border-b bg-muted/20 shrink-0">
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

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground font-mono pr-1">
          {editorState.cursor.line}:{editorState.cursor.col}
        </span>

        {connection ? (
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded",
              "bg-muted text-muted-foreground",
            )}
          >
            {DIALECT_LABELS[dialect]}
          </span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground"
                />
              }
            >
              {DIALECT_LABELS[dialect]}
            </DropdownMenuTrigger>

            <DropdownMenuContent side="bottom" align="end" className="min-w-36">
              <DropdownMenuRadioGroup
                value={dialect}
                onValueChange={(value) => setDialectOverride(value as DbDriver)}
              >
                <DropdownMenuRadioItem value="postgres">
                  PostgreSQL
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="mysql">
                  MySQL
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="sqlite">
                  SQLite
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={activeTabId}
          ref={editorRef}
          value={sql}
          driver={dialect}
          editorState={editorState}
          onChange={updateSql}
          onEditorStateChange={handleEditorStateChange}
          onRun={() => runSql()}
          onFormat={handleFormat}
        />
      </div>

      <div className="flex-none flex items-center gap-4 px-3 h-6 border-t bg-muted/10 shrink-0 text-[11px] text-muted-foreground">
        <span>{summary.lineCount} 行</span>
        <span>
          第 {editorState.cursor.line} 行，第 {editorState.cursor.col} 列
        </span>
        <span>{DIALECT_LABELS[dialect]}</span>
        <span>{summary.selectedChars} 个已选字符</span>
        <span>{summary.selectedLines} 个已选行</span>
      </div>
    </div>
  )
}
