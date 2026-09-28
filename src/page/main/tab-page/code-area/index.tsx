import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { AlignLeft, Play, RefreshCw, Search, Square } from "lucide-react"
import { useMemo, useRef } from "react"
import { toast } from "sonner"
import type { SqlLanguage } from "sql-formatter"
import { format as formatSql } from "sql-formatter"
import { Button } from "@/components/ui/button"
import type { DbDriver } from "@/lib/conn"
import type { QueryTabEditorState } from "@/lib/tabs"
import {
  activeQueryTabAtom,
  activeQueryTabConfigAtom,
  activeQueryTabEditorStateAtom,
  activeSessionAtom,
  activeTabIdAtom,
  cancelActiveQueryAtom,
  rebuildActiveSessionAtom,
  runActiveQueryTabSqlAtom,
} from "@/lib/tabs/renderer"
import { AreaStatusBar, AreaToolbar } from "../bars"
import { SqlEditor, type SqlEditorHandle } from "./sql-editor"

const FORMAT_LANGUAGE_MAP: Record<DbDriver, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
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

function getEditorSummary(state: QueryTabEditorState) {
  let selectedChars = 0
  const selectedLines = new Set<number>()

  for (const selection of state.selections) {
    const start = Math.min(selection.anchor, selection.head)
    const end = Math.max(selection.anchor, selection.head)

    if (start === end) {
      continue
    }

    selectedChars += end - start

    const firstLine = getLineNumberAt(state.text, start)
    const lastLine = getLineNumberAt(state.text, Math.max(end - 1, start))

    for (let line = firstLine; line <= lastLine; line += 1) {
      selectedLines.add(line)
    }
  }

  return {
    lineCount: getLineCount(state.text),
    selectedChars,
    selectedLines: selectedLines.size,
  }
}

function isSameEditorState(
  left: QueryTabEditorState,
  right: QueryTabEditorState,
): boolean {
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

export default function CoreArea() {
  const tabId = useAtomValue(activeTabIdAtom)
  const config = useAtomValue(activeQueryTabConfigAtom)
  const tab = useAtomValue(activeQueryTabAtom)
  const session = useAtomValue(activeSessionAtom)
  const cancel = useSetAtom(cancelActiveQueryAtom)
  const rebuild = useSetAtom(rebuildActiveSessionAtom)
  const failed =
    !!tab?.sessionId &&
    (!session || session.status === "failed" || session.status === "closed")
  const act = (run: () => Promise<unknown>) => {
    void run().catch((error) =>
      toast.error(error instanceof Error ? error.message : "操作失败"),
    )
  }

  const [state, setState] = useAtom(activeQueryTabEditorStateAtom)

  const runSql = useSetAtom(runActiveQueryTabSqlAtom)

  const editorRef = useRef<SqlEditorHandle | null>(null)

  const summary = useMemo(() => getEditorSummary(state), [state])

  const handleEditorStateChange = (nextEditorState: QueryTabEditorState) => {
    setState((current) => {
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
    })
  }

  const handleFormat = () => {
    if (!state.text.trim()) {
      return
    }

    try {
      const formatted = formatSql(state.text, {
        language: config?.driver
          ? FORMAT_LANGUAGE_MAP[config.driver]
          : DEFAULT_FORMAT_LANGUAGE,
        tabWidth: 2,
        keywordCase: "upper",
      })

      if (formatted !== state.text) {
        setState((current) => ({ ...current, text: formatted }))
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
          disabled={state.status === "running" || tab?.closing || failed}
          title="运行 SQL (Ctrl/Cmd + Enter)"
        >
          <Play className="size-3" />
          运行
        </Button>

        {state.status === "running" && (
          <Button
            variant="outline"
            size="xs"
            disabled={tab?.phase === "cancelling" || tab?.closing}
            onClick={() => act(cancel)}
          >
            <Square className="size-3" />
            {tab?.phase === "cancelling" ? "取消中" : "停止"}
          </Button>
        )}
        {(failed || state.status === "running") && (
          <Button
            variant="ghost"
            size="xs"
            disabled={tab?.closing}
            onClick={() => act(rebuild)}
            title="关闭原会话并建立新会话，SQL 不会自动执行"
          >
            <RefreshCw className="size-3" />
            {failed ? "重建会话" : "断开并重建"}
          </Button>
        )}

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
        {config && (
          <span title={session?.error ?? undefined}>
            {tab?.closing
              ? "正在关闭会话"
              : tab?.phase === "cancelling"
                ? "取消请求处理中，等待查询最终结果"
                : state.status === "running"
                  ? tab?.phase === "connecting"
                    ? "连接中 / 请求处理中"
                    : "请求处理中"
                  : failed
                    ? "会话已失效，需重建；事务和临时状态不会恢复"
                    : session
                      ? "独立会话"
                      : "首次执行时建立独立会话"}
          </span>
        )}
        <span>{summary.lineCount} 行</span>
        <span>
          第 {state.cursor.line} 行，第 {state.cursor.col} 列
        </span>
        <span>{summary.selectedChars} 个已选字符</span>
        <span>{summary.selectedLines} 个已选行</span>
        {!config && <span>未绑定连接，当前为纯文本模式</span>}
      </AreaStatusBar>

      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={tabId}
          ref={editorRef}
          value={state.text}
          driver={config?.driver}
          editorState={state}
          onChange={(text) => setState((current) => ({ ...current, text }))}
          onEditorStateChange={handleEditorStateChange}
          onRun={() => runSql()}
          onFormat={handleFormat}
        />
      </div>
    </div>
  )
}
