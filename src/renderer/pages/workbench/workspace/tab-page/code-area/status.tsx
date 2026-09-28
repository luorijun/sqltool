import type { EditorState } from "@/renderer/components/sql-editor"
import { AreaStatusBar } from "@/renderer/components/ui/panel-bar"

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

export default function CodeStatus({ state }: { state: EditorState }) {
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
