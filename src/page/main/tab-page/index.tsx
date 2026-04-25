import { ResizeContainer } from "@/components/ui/resizer"
import { CodeArea } from "./code-area"
import LogArea from "./log-area"
import { TableArea } from "./table-area"

const MIN_TABLE_HEIGHT = 80
const MIN_BOTTOM_HEIGHT = 120
const MIN_LOG_WIDTH = 240
const MIN_CODE_WIDTH = 160

export default function TabPage() {
  return (
    <ResizeContainer
      axis="y"
      fixed="first"
      defaultSize={(containerHeight) => (containerHeight * 2) / 3}
      minSize={MIN_TABLE_HEIGHT}
      minRemainingSize={MIN_BOTTOM_HEIGHT}
      className="flex-1 min-h-0"
      dividerLabel="上下拖拽调节结果区高度"
      first={<TableArea />}
      second={
        <ResizeContainer
          axis="x"
          fixed="second"
          defaultSize={(containerWidth) => containerWidth / 3}
          minSize={MIN_LOG_WIDTH}
          minRemainingSize={MIN_CODE_WIDTH}
          className="size-full min-h-0"
          dividerLabel="左右拖拽调节日志区宽度"
          first={<CodeArea />}
          second={<LogArea />}
        />
      }
    />
  )
}
