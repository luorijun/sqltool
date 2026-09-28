import { useAtomValue, useSetAtom } from "jotai"
import { AlignLeft, Play, RefreshCw, Search, Square } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import type { SqlLanguage } from "sql-formatter"
import { format as formatSql } from "sql-formatter"
import type { DbDriver } from "@/contracts/database"
import {
  type EditorState,
  SqlEditor,
  type SqlEditorHandle,
} from "@/renderer/components/sql-editor"
import { Button } from "@/renderer/components/ui/button"
import { AreaToolbar } from "@/renderer/components/ui/panel-bar"
import {
  activeQueryTabAtom,
  activeQueryTabConfigAtom,
  activeQueryTabEditorStateAtom,
  activeSessionAtom,
  activeTabIdAtom,
  bindQueryConfigAtom,
  cancelActiveQueryAtom,
  rebuildActiveSessionAtom,
  runActiveQueryTabSqlAtom,
  updateQueryEditorAtom,
} from "@/renderer/modules/workspace"
import CodeConfig from "./config"
import CodeStatus from "./status"

const FORMAT_LANGUAGE_MAP: Record<DbDriver, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
}

const DEFAULT_FORMAT_LANGUAGE: SqlLanguage = "sql"

function isSameEditorState(left: EditorState, right: EditorState): boolean {
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
  const bind = useSetAtom(bindQueryConfigAtom)
  const failed =
    !!tab?.sessionId &&
    (!session || session.status === "failed" || session.status === "closed")
  const act = (run: () => Promise<unknown>) => {
    void run().catch((error) =>
      toast.error(error instanceof Error ? error.message : "操作失败"),
    )
  }

  const state = useAtomValue(activeQueryTabEditorStateAtom)

  const update = useSetAtom(updateQueryEditorAtom)
  const setState = (change: (current: EditorState) => EditorState) =>
    update({ tabId, update: change })

  const runSql = useSetAtom(runActiveQueryTabSqlAtom)

  const editorRef = useRef<SqlEditorHandle | null>(null)

  const connectionStatus = tab?.closing
    ? "正在关闭会话"
    : tab?.phase === "cancelling"
      ? "取消请求处理中，等待查询最终结果"
      : state.status === "running"
        ? tab?.phase === "connecting"
          ? "连接中"
          : "正在执行查询"
        : failed
          ? "会话已失效，请重建会话"
          : session
            ? "已连接"
            : config
              ? "首次执行时连接"
              : "未绑定配置"

  const handleEditorStateChange = (nextEditorState: EditorState) => {
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
      <AreaToolbar className="overflow-x-auto">
        <span className="shrink-0 px-1 text-xs text-muted-foreground">
          SQL 编辑器
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="default"
            size="xs"
            className="gap-1.5"
            onClick={() => runSql()}
            disabled={
              !config || state.status === "running" || tab?.closing || failed
            }
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
          <CodeConfig
            configId={tab?.configId}
            status={connectionStatus}
            disabled={tab?.closing || state.status === "running"}
            onChange={(configId) => {
              if (tab) act(() => bind({ tabId: tab.id, configId }))
            }}
          />
        </div>
      </AreaToolbar>

      <CodeStatus state={state} />

      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={tabId}
          ref={editorRef}
          autoFocus
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
