import type { SelectOrderBy, TableSource } from "@/core/database"

interface EditorSnapshot {
  text: string
  cursor: { line: number; col: number }
  selections: Array<{ anchor: number; head: number }>
  mainSelectionIndex: number
  scroll: { top: number; left: number }
  search: {
    query: string
    replace: string
    caseSensitive: boolean
    wholeWord: boolean
    regexp: boolean
    open: boolean
  }
}

type WorkspaceTab = {
  id: string
  label: string
} & (
  | { kind: "query"; configId?: string; editor: EditorSnapshot }
  | {
      kind: "view"
      configId: string
      source: TableSource
      sort: SelectOrderBy[]
      sortOrder: string[]
      offset: number
      limit: number
    }
)

export interface WorkspaceSnapshot {
  version: 1
  activeTabId: string | null
  tabs: WorkspaceTab[]
}
