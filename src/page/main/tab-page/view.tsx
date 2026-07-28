import { ResizeContainer } from "@/components/ui/resizer"
import LoggerArea from "./logger-area"
import ViewTableArea from "./table-area/view"

const MIN_TABLE_HEIGHT = 80
const MIN_LOG_HEIGHT = 120

export function ViewTabPage() {
  return (
    <ResizeContainer
      axis="y"
      fixed="first"
      defaultSize={(containerHeight) => (containerHeight * 3) / 4}
      minSize={MIN_TABLE_HEIGHT}
      minRemainingSize={MIN_LOG_HEIGHT}
      className="flex-1 min-h-0"
      dividerLabel="上下拖拽调节结果区高度"
      first={<ViewTableArea />}
      second={<LoggerArea />}
    />
  )
}
