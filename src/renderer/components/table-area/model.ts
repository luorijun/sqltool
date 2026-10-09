import {
  type Column,
  type ColumnDef,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  type ReactTable,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table"
import type { CellChange, QueryResultColumn } from "@/core/database"
import type { SaveTextFileOptions } from "@/preload/bridge"
import type { GridSelection } from "./selection"

export const features = tableFeatures({
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
})

export interface ResultTableState extends ResultLayout {
  selection: GridSelection | null
  dataAt: number | null
  data: Record<string, unknown>[]
  columns: QueryResultColumn[]
}
export interface ResultLayout {
  visibility: Record<string, boolean>
  sizing: Record<string, number>
  pinning: { start: string[]; end: string[] }
}
export const ROW_NUMBER_COLUMN_ID = "__rownum__"
export type ResultRow = Record<string, unknown>
export type ResultTableInstance = ReactTable<typeof features, ResultRow>
export type ResultColumn = Column<typeof features, ResultRow, unknown>
export type ResultColumnDef = ColumnDef<typeof features, ResultRow>
export interface ResultEditing {
  changes: CellChange[]
  writable: string[]
  busy: boolean
  canSave: boolean
  reason?: string
  error?: string
  notice?: string
  canUndo: boolean
  canRedo: boolean
  onChange: (row: number, column: string, value: unknown) => void
  onEditing: (editing: boolean) => void
  onUndo: () => void
  onRedo: () => void
  onDiscard: () => void
  onSave: () => void
}
export interface ResultActions {
  onExport: (options: SaveTextFileOptions) => Promise<void>
  onError: (message: string) => void
}
