import { AlignLeft, Play } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Mock SQL ─────────────────────────────────────────────────────────────────

const MOCK_SQL = `-- 查询近 30 天注册的用户列表
SELECT
  u.id,
  u.username,
  u.email,
  u.role,
  u.status,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.role = 'member'
  AND u.created_at > NOW() - INTERVAL '30 days'
ORDER BY u.created_at DESC
LIMIT 100;
`

// ─── Line Numbers ─────────────────────────────────────────────────────────────

function LineNumbers({
  lineCount,
  scrollTop,
  lineHeight,
}: {
  lineCount: number
  scrollTop: number
  lineHeight: number
}) {
  return (
    <div className="relative flex-none w-11 bg-muted/20 border-r overflow-hidden select-none shrink-0">
      <div
        className="absolute inset-x-0 top-0"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className="px-2 text-right text-xs font-mono text-muted-foreground/60"
            style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}
          >
            {i + 1}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

const LINE_HEIGHT = 20 // px — must match the textarea's line-height

export function CodeArea() {
  const [sql, setSql] = useState(MOCK_SQL)
  const [scrollTop, setScrollTop] = useState(0)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lineCount = sql.split("\n").length

  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop)
    }
  }, [])

  const handleKeyUp = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const before = el.value.slice(0, el.selectionStart)
    const lines = before.split("\n")
    setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1 })
  }, [])

  return (
    <div className="size-full flex flex-col overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center gap-1 px-2 h-9 border-b bg-muted/20 shrink-0">
        <Button variant="default" size="xs" className="gap-1.5">
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cursor position */}
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
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Line numbers gutter */}
        <LineNumbers
          lineCount={lineCount}
          scrollTop={scrollTop}
          lineHeight={LINE_HEIGHT}
        />

        {/* Textarea */}
        <div className="flex-1 relative overflow-hidden">
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onScroll={handleScroll}
            onKeyUp={handleKeyUp}
            onClick={handleKeyUp}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={cn(
              "absolute inset-0 w-full h-full",
              "resize-none bg-transparent",
              "py-0 px-3",
              "text-sm font-mono",
              "text-foreground caret-foreground",
              "outline-none focus:outline-none",
              "overflow-auto",
              // Subtle selection color
              "selection:bg-primary/20",
            )}
            style={{
              lineHeight: `${LINE_HEIGHT}px`,
              tabSize: 2,
              // Padding top to align with line numbers
              paddingTop: 0,
            }}
          />
        </div>
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
