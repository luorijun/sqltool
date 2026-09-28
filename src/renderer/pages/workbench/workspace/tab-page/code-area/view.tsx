import { useAtomValue, useSetAtom } from "jotai"
import { Search } from "lucide-react"
import { useRef } from "react"
import {
  SqlEditor,
  type SqlEditorHandle,
} from "@/renderer/components/sql-editor"
import { Button } from "@/renderer/components/ui/button"
import { AreaToolbar } from "@/renderer/components/ui/panel-bar"
import { connectionEntriesAtom } from "@/renderer/modules/database"
import {
  activeResultStaleAtom,
  activeViewTabAtom,
  updateViewCodeAtom,
} from "@/renderer/modules/workspace"
import CodeConfig from "./config"
import CodeStatus from "./status"

export default function ViewCodeArea() {
  const tab = useAtomValue(activeViewTabAtom)
  const connections = useAtomValue(connectionEntriesAtom)
  const stale = useAtomValue(activeResultStaleAtom)
  const update = useSetAtom(updateViewCodeAtom)
  const editorRef = useRef<SqlEditorHandle | null>(null)

  if (!tab) return null

  const config = connections?.find(
    (entry) => entry.config.id === tab.configId,
  )?.config
  const { table, code } = tab
  const state = { ...code, text: table.sql }
  const status =
    table.dataAt === null
      ? table.status === "error"
        ? "数据加载未成功，暂无可展示的 SQL"
        : "等待数据加载完成后展示 SQL"
      : table.status === "running"
        ? "正在加载，显示此前结果的 SQL"
        : stale || table.status === "error"
          ? "此前结果的 SQL"
          : "当前结果的 SQL"

  return (
    <div className="size-full flex flex-col overflow-hidden">
      <AreaToolbar className="overflow-x-auto">
        <span
          className="shrink-0 px-1 text-xs text-muted-foreground"
          title={status}
        >
          数据查询 · 只读
        </span>
        {(table.status !== "success" || stale) && (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={status}
          >
            {table.dataAt === null ? "暂无 SQL" : "此前结果"}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
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
          <CodeConfig configId={tab.configId} />
        </div>
      </AreaToolbar>
      <CodeStatus state={state} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          key={tab.id}
          ref={editorRef}
          value={table.sql}
          driver={config?.driver}
          readOnly
          editorState={state}
          onEditorStateChange={(view) => update({ tabId: tab.id, view })}
        />
      </div>
    </div>
  )
}
