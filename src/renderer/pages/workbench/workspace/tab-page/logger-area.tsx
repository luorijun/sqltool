import { useAtomValue, useSetAtom } from "jotai"
import { type LogView, RunLog } from "@/renderer/components/run-log"
import {
  activeTabIdAtom,
  activeTabLoggerAtom,
  clearLogsAtom,
  updateLogViewAtom,
} from "@/renderer/modules/workspace"
import { copyText, showError } from "../feedback"

export default function LoggerArea() {
  const state = useAtomValue(activeTabLoggerAtom)
  const tabId = useAtomValue(activeTabIdAtom)
  const clear = useSetAtom(clearLogsAtom)
  const update = useSetAtom(updateLogViewAtom)
  const setState = (change: (current: LogView) => LogView) => {
    if (tabId === null) return
    update({ tabId, update: change })
  }
  return (
    <RunLog
      onClear={() => {
        if (tabId !== null) clear(tabId)
      }}
      state={state}
      onChange={setState}
      onCopy={copyText}
      onError={showError}
    />
  )
}
