import { useAtomValue, useSetAtom } from "jotai"
import { AlignLeft, Play } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  activeTabContentAtom,
  activeTabSqlAtom,
  runActiveTabSqlAtom,
  updateActiveSqlAtom,
} from "@/lib/tabs"
import { cn } from "@/lib/utils"
import { type CursorPosition, SqlEditor } from "./sql-editor"

function getLineCount(sql: string): number {
  return sql ? sql.split("\n").length : 1
}

const DEFAULT_CURSOR: CursorPosition = { line: 1, col: 1 }

export function CodeArea() {
  const content = useAtomValue(activeTabContentAtom)
  const sql = useAtomValue(activeTabSqlAtom)
  const updateSql = useSetAtom(updateActiveSqlAtom)
  const runSql = useSetAtom(runActiveTabSqlAtom)
  const [cursor, setCursor] = useState<CursorPosition>(DEFAULT_CURSOR)

  const handleCursorChange = useCallback((nextCursor: CursorPosition) => {
    setCursor(nextCursor)
  }, [])

  const lineCount = getLineCount(sql)

  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center gap-1 px-2 h-9 border-b bg-muted/20 shrink-0">
        <Button
          variant="default"
          size="xs"
          className="gap-1.5"
          onClick={() => runSql()}
          disabled={content?.running}
        >
          <Play className="size-3" />
          运行
        </Button>

        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
        >
          <AlignLeft className="size-3" />
          格式化
        </Button>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground font-mono pr-1">
          {cursor.line}:{cursor.col}
        </span>

        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded",
            "bg-muted text-muted-foreground",
          )}
        >
          SQL
        </span>
      </div>

      {/* ── Editor body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor
          value={sql}
          driver={content?.connection?.driver}
          onChange={updateSql}
          onCursorChange={handleCursorChange}
        />
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center gap-4 px-3 h-6 border-t bg-muted/10 shrink-0">
        <span className="text-[11px] text-muted-foreground">
          {lineCount} 行
        </span>
        <span className="text-[11px] text-muted-foreground">UTF-8</span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          第 {cursor.line} 行，第 {cursor.col} 列
        </span>
      </div>
    </div>
  )
}
