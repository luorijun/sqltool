import type { Column, ColumnDef, ReactTable } from "@tanstack/react-table"
import type { QueryResultColumn } from "@/contracts/database"
import type { SaveTextFileOptions } from "@/contracts/system"
import type { features } from "./features"
import type { GridSelection } from "./selection"
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
export interface ResultActions {
  onExport: (options: SaveTextFileOptions) => Promise<void>
  onError: (message: string) => void
}
