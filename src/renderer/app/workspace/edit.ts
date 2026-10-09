import { useSetAtom } from "jotai"
import { useMemo } from "react"
import type { ResultEditing } from "@/renderer/components/table-area"
import {
  changeCellAtom,
  discardEditsAtom,
  editedRows,
  saveEditsAtom,
  saveReason,
  setCellEditingAtom,
  type TabState,
  undoEditAtom,
} from "@/renderer/modules/workspace"

export function useTableEditing(tab: TabState | null, stale: boolean) {
  const change = useSetAtom(changeCellAtom)
  const undo = useSetAtom(undoEditAtom)
  const discard = useSetAtom(discardEditsAtom)
  const save = useSetAtom(saveEditsAtom)
  const setEditing = useSetAtom(setCellEditingAtom)
  const edit = tab?.table.edits
  const data = useMemo(
    () => editedRows(tab?.table.data ?? [], edit?.changes ?? []),
    [tab?.table.data, edit?.changes],
  )
  const reason = tab ? saveReason(tab, stale) : undefined
  const editing: ResultEditing | undefined = tab
    ? {
        changes: edit?.changes ?? [],
        busy: !!edit?.saving || !!edit?.confirming || !!tab.closing,
        canSave: !reason,
        reason,
        error: edit?.error,
        notice: edit?.notice,
        canUndo: !!edit?.history.length,
        canRedo: !!edit?.future.length,
        onChange: (row, column, value) =>
          change({ tabId: tab.id, row, column, value }),
        onEditing: (editing) => setEditing({ tabId: tab.id, editing }),
        onUndo: () => undo({ tabId: tab.id }),
        onRedo: () => undo({ tabId: tab.id, redo: true }),
        onDiscard: () => discard({ tabId: tab.id }),
        onSave: () => {
          void save({ tabId: tab.id })
        },
        writable: edit?.info?.writable ?? [],
      }
    : undefined
  return { data, editing }
}
