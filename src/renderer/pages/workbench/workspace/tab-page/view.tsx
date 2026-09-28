import { ResizeContainer } from "@/renderer/components/ui/resizer"
import ViewCodeArea from "./code-area/view"
import LoggerArea from "./logger-area"
import ViewTableArea from "./table-area/view"

const MIN_TABLE_HEIGHT = 80
const MIN_BOTTOM_HEIGHT = 120
const MIN_LOG_WIDTH = 240
const MIN_CODE_WIDTH = 160

export function ViewTabPage() {
  return (
    <ResizeContainer
      axis="y"
      fixed="first"
      defaultSize={(containerHeight) => (containerHeight * 3) / 4}
      minSize={MIN_TABLE_HEIGHT}
      minRemainingSize={MIN_BOTTOM_HEIGHT}
      className="flex-1 min-h-0"
      dividerLabel="上下拖拽调节结果区高度"
      first={<ViewTableArea />}
      second={
        <ResizeContainer
          axis="x"
          fixed="second"
          defaultSize={(containerWidth) => containerWidth / 3}
          minSize={MIN_LOG_WIDTH}
          minRemainingSize={MIN_CODE_WIDTH}
          className="size-full min-h-0"
          dividerLabel="左右拖拽调节日志区宽度"
          first={<ViewCodeArea />}
          second={<LoggerArea />}
        />
      }
    />
  )
}
