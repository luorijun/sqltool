import type { Table } from "@tanstack/react-table"
import type { QueryResultColumn } from "@/contracts/database"
import type { SaveTextFileOptions } from "@/contracts/system"
export interface ResultTableState extends ResultLayout {
  dataAt: number | null
  data: Record<string, unknown>[]
  columns: QueryResultColumn[]
}
export interface ResultLayout {
  visibility: Record<string, boolean>
  sizing: Record<string, number>
  pinning: { left: string[]; right: string[] }
  selected: { rowId: string; colId: string } | null
  sorting?: Array<{ id: string; desc: boolean }>
}
export const ROW_NUMBER_COLUMN_ID = "__rownum__"
export type ResultRow = Record<string, unknown>
export type ResultTableInstance = Table<ResultRow>
export interface ResultActions {
  onCopy: (text: string, message: string) => Promise<void>
  onExport: (options: SaveTextFileOptions) => Promise<void>
  onError: (message: string) => void
}
