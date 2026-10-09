import { useCallback, useRef, useState } from "react"
import type { QueryResultColumn } from "@/core/database"
import { Button } from "@/renderer/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/renderer/components/ui/dialog"
import { editText, parseEdit } from "./edit-value"

type EditControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export function focusEditor(node: EditControl) {
  node.focus()
  if ("setSelectionRange" in node) {
    const end = node.value.length
    node.setSelectionRange(end, end)
  }
}

export function CellEditor({
  value,
  column,
  initial,
  draft = false,
  onCommit,
  onCancel,
}: {
  value: unknown
  column: QueryResultColumn
  initial?: string
  draft?: boolean
  onCommit: (value: unknown, move?: number) => void
  onCancel: () => void
}) {
  const originalText = editText(value, column, draft)
  const [text, setText] = useState(() => initial ?? originalText)
  const [isNull, setNull] = useState(value === null && initial === undefined)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<EditControl | null>(null)
  const attach = useCallback((node: EditControl | null) => {
    ref.current = node
    if (node) focusEditor(node)
  }, [])
  const done = useRef(false)
  const expanded =
    (["json", "array", "binary", "unknown"].includes(column.typeFamily) &&
      (column.typeFamily !== "unknown" || typeof value === "object")) ||
    originalText.length > 160 ||
    originalText.includes("\n")
  function commit(move?: number) {
    if (done.current) return
    try {
      const next = isNull ? null : parseEdit(text, column, value, draft)
      done.current = true
      onCommit(next, move)
    } catch (error) {
      setError(error instanceof Error ? error.message : "无效的值")
      ref.current?.focus()
    }
  }
  function cancel() {
    if (done.current) return
    done.current = true
    onCancel()
  }
  const keys = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      cancel()
    } else if (
      event.key === "Enter" &&
      (!expanded || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault()
      event.stopPropagation()
      commit(0)
    } else if (event.key === "Tab" && !expanded) {
      event.preventDefault()
      event.stopPropagation()
      commit(event.shiftKey ? -1 : 1)
    }
  }
  const input =
    column.typeFamily === "boolean" ? (
      <select
        ref={attach}
        aria-label={`编辑 ${column.name}`}
        value={
          isNull ? "null" : text === "0" || text === "false" ? "false" : "true"
        }
        onKeyDown={keys}
        onChange={(event) => {
          setNull(event.target.value === "null")
          setText(event.target.value)
        }}
        className="w-full bg-transparent outline-none"
      >
        <option value="null">NULL</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    ) : expanded ? (
      <textarea
        ref={attach}
        aria-label={`编辑 ${column.name}`}
        value={text}
        onKeyDown={keys}
        onChange={(event) => {
          setText(event.target.value)
          setNull(false)
          setError(null)
        }}
        className="min-h-48 w-full flex-1 resize-y border border-input rounded bg-input/30 p-3 font-mono text-xs caret-foreground outline-none select-text focus:border-ring focus:ring-2 focus:ring-ring/50"
      />
    ) : (
      <input
        ref={attach}
        aria-label={`编辑 ${column.name}`}
        value={text}
        onKeyDown={keys}
        onChange={(event) => {
          setText(event.target.value)
          setNull(false)
          setError(null)
        }}
        className="w-full min-w-0 bg-transparent font-mono text-xs caret-foreground outline-none select-text"
      />
    )
  if (expanded)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) cancel()
        }}
      >
        <DialogContent className="w-160" showCloseButton={false}>
          <DialogTitle>编辑 {column.name}</DialogTitle>
          <DialogDescription>
            {column.typeFamily === "binary"
              ? "使用十六进制字节编辑。Ctrl+Enter 确认。"
              : column.typeFamily === "array" &&
                  column.driver === "postgres" &&
                  typeof value === "string"
                ? "使用 PostgreSQL 数组文本格式编辑。Ctrl+Enter 确认。"
                : "修改当前单元格。Ctrl+Enter 确认。"}
          </DialogDescription>
          {input}
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNull(true)
                setText("")
                setError(null)
              }}
            >
              {isNull ? "当前为 NULL" : "设为 NULL"}
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={cancel}>
              取消
            </Button>
            <Button onClick={() => commit(0)}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  return (
    <div
      role="group"
      aria-label="单元格编辑"
      data-cell-editor
      className="relative select-text"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit()
      }}
    >
      {input}
      {error && (
        <span
          role="alert"
          className="absolute top-full left-0 z-30 whitespace-nowrap border bg-background p-2 text-xs text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  )
}
