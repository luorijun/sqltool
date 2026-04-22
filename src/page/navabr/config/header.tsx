import { Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface ConfigHeaderProps {
  onCreate: () => void
  onRefresh: () => void
}

export function ConfigHeader({ onCreate, onRefresh }: ConfigHeaderProps) {
  return (
    <div className="flex-none basis-10 overflow-hidden border-b px-2 py-2 flex items-center justify-between shrink-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        连接
      </span>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCreate}
          title="新建连接"
        >
          <Plus />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          title="刷新连接列表"
        >
          <RefreshCw />
        </Button>
      </div>
    </div>
  )
}
