import {
  AlignLeft,
  ChevronDown,
  Database,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react"
import { useRef } from "react"
import { format as formatSql, type SqlLanguage } from "sql-formatter"
import type { Config, DbDriver, DbSchema } from "@/core/database"
import { Button } from "@/renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
import { AreaStatusBar, AreaToolbar } from "@/renderer/components/ui/panel-bar"
import { SqlEditor, type SqlEditorHandle } from "./editor"
import type { EditorState } from "./types"

export type { EditorState } from "./types"

type ConfigOption = Pick<Config, "id" | "name" | "database" | "host" | "port">
interface CodeAreaBase {
  id: string | null
  state: EditorState
  driver?: DbDriver
  configId?: string
  connections: ConfigOption[] | null
  onStateChange: (update: (current: EditorState) => EditorState) => void
  onError: (message: string) => void
}
export type CodeAreaProps = CodeAreaBase &
  (
    | {
        mode: "query"
        running: boolean
        failed: boolean
        closing: boolean
        cancelling: boolean
        canRun: boolean
        status: string
        schema?: readonly DbSchema[]
        loadSchema?: () => Promise<readonly DbSchema[]>
        onRun: () => void
        onCancel: () => void
        onRebuild: () => void
        onConfigChange: (id?: string) => void
      }
    | { mode: "view"; status: string; notice?: string }
  )
const FORMAT_LANGUAGE: Record<DbDriver, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
}

export function CodeArea(props: CodeAreaProps) {
  const { state, onStateChange } = props
  const editor = useRef<SqlEditorHandle | null>(null)
  const format = () => {
    if (props.mode !== "query" || !state.text.trim()) return
    try {
      const text = formatSql(state.text, {
        language: props.driver ? FORMAT_LANGUAGE[props.driver] : "sql",
        tabWidth: 2,
        keywordCase: "upper",
      })
      if (text !== state.text)
        onStateChange((current) => ({ ...current, text }))
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "SQL 格式化失败")
    }
  }
  const update = (next: EditorState) => {
    onStateChange((current) =>
      isSameEditorState(current, next)
        ? current
        : {
            ...current,
            cursor: next.cursor,
            selections: next.selections,
            mainSelectionIndex: next.mainSelectionIndex,
            scroll: next.scroll,
            search: next.search,
          },
    )
  }
  return (
    <div className="size-full flex flex-col overflow-hidden">
      <AreaToolbar className="overflow-x-auto">
        <span
          className="shrink-0 px-1 text-xs text-muted-foreground"
          title={props.mode === "view" ? props.status : undefined}
        >
          {props.mode === "query" ? "SQL 编辑器" : "数据查询 · 只读"}
        </span>
        {props.mode === "view" && props.notice && (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={props.status}
          >
            {props.notice}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {props.mode === "query" && (
            <>
              <Button
                variant="default"
                size="xs"
                className="gap-1.5"
                onClick={props.onRun}
                disabled={!props.canRun}
                title="运行 SQL (F5)"
                aria-keyshortcuts="F5"
              >
                <Play className="size-3" />
                运行
              </Button>
              {props.running && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={props.cancelling || props.closing}
                  onClick={props.onCancel}
                >
                  <Square className="size-3" />
                  {props.cancelling ? "取消中" : "停止"}
                </Button>
              )}
              {(props.failed || props.running) && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={props.closing}
                  onClick={props.onRebuild}
                  title="关闭原会话并建立新会话，SQL 不会自动执行"
                >
                  <RefreshCw className="size-3" />
                  {props.failed ? "重建会话" : "断开并重建"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                className="gap-1.5 text-muted-foreground"
                onClick={format}
                title="格式化 SQL (Shift + Alt + F)"
              >
                <AlignLeft className="size-3" />
                格式化
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground"
            onClick={() => editor.current?.openSearch()}
            title="搜索 (Ctrl/Cmd + F)"
          >
            <Search className="size-3" />
            搜索
          </Button>
          <CodeConfig
            connections={props.connections}
            configId={props.configId}
            status={props.mode === "query" ? props.status : undefined}
            disabled={
              props.mode === "query" && (props.closing || props.running)
            }
            onChange={props.mode === "query" ? props.onConfigChange : undefined}
          />
        </div>
      </AreaToolbar>
      <CodeStatus state={state} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={props.id}
          ref={editor}
          autoFocus={props.mode === "query"}
          value={state.text}
          driver={props.driver}
          schema={props.mode === "query" ? props.schema : undefined}
          loadSchema={props.mode === "query" ? props.loadSchema : undefined}
          readOnly={props.mode === "view"}
          editorState={state}
          onChange={
            props.mode === "query"
              ? (text) => onStateChange((current) => ({ ...current, text }))
              : undefined
          }
          onEditorStateChange={update}
          onRun={props.mode === "query" ? props.onRun : undefined}
          onFormat={props.mode === "query" ? format : undefined}
        />
      </div>
    </div>
  )
}

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

interface CodeConfigProps {
  connections: ConfigOption[] | null
  configId?: string
  status?: string
  disabled?: boolean
  onChange?: (configId?: string) => void
}

function CodeConfig({
  configId,
  status,
  disabled,
  onChange,
  connections,
}: CodeConfigProps) {
  const config = connections?.find((entry) => entry.id === configId)
  const label = config
    ? config.name || config.database
    : configId
      ? connections === null
        ? "配置加载中"
        : "配置已删除"
      : "绑定配置"
  const detail = config
    ? `${config.name || config.database} · ${config.database} · ${config.host}:${config.port}`
    : label
  const title = [detail, status].filter(Boolean).join("\n")
  const content = (
    <>
      <Database className="size-3 shrink-0" />
      <span className="max-w-36 truncate">{label}</span>
    </>
  )

  if (!onChange) {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground"
        title={`${title}\n只读查询，不可修改绑定配置`}
      >
        {content}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || connections === null}
            title={title}
            aria-label={`绑定配置：${label}`}
            className="gap-1.5 shrink-0 text-muted-foreground"
          />
        }
      >
        {content}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={configId ?? ""}
          onValueChange={(value) => onChange(value || undefined)}
        >
          <DropdownMenuRadioItem value="" disabled={disabled}>
            未绑定配置
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {connections?.map((item) => (
            <DropdownMenuRadioItem
              key={item.id}
              value={item.id}
              disabled={disabled}
            >
              <div className="min-w-0">
                <div className="truncate">{item.name || item.database}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.database} · {item.host}:{item.port}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {connections?.length === 0 && (
          <DropdownMenuItem disabled>
            暂无配置，请先在侧边栏添加连接
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getLineNumberAt(sql: string, pos: number): number {
  let line = 1
  const end = Math.min(Math.max(pos, 0), sql.length)
  for (let index = 0; index < end; index += 1) {
    if (sql[index] === "\n") line += 1
  }
  return line
}

function getSummary(state: EditorState) {
  let selectedChars = 0
  const selectedLines = new Set<number>()
  for (const selection of state.selections) {
    const start = Math.max(
      0,
      Math.min(selection.anchor, selection.head, state.text.length),
    )
    const end = Math.max(
      0,
      Math.min(Math.max(selection.anchor, selection.head), state.text.length),
    )
    if (start === end) continue
    selectedChars += end - start
    const firstLine = getLineNumberAt(state.text, start)
    const lastLine = getLineNumberAt(state.text, Math.max(end - 1, start))
    for (let line = firstLine; line <= lastLine; line += 1)
      selectedLines.add(line)
  }
  return {
    lineCount: state.text.split("\n").length,
    selectedChars,
    selectedLines: selectedLines.size,
  }
}

function CodeStatus({ state }: { state: EditorState }) {
  const summary = getSummary(state)
  return (
    <AreaStatusBar className="px-3 text-[11px]">
      <span>{summary.lineCount} 行</span>
      <span>
        第 {state.cursor.line} 行，第 {state.cursor.col} 列
      </span>
      <span>{summary.selectedChars} 个已选字符</span>
      <span>{summary.selectedLines} 个已选行</span>
    </AreaStatusBar>
  )
}
