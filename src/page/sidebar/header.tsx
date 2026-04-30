import { useSetAtom } from "jotai"
import { Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { refreshConnectionsAtom } from "@/lib/conn/state"

export function SidebarHeader({ onCreate }: { onCreate: () => void }) {
  const refreshConnections = useSetAtom(refreshConnectionsAtom)
  const handleRefreshList = async () => {
    try {
      await refreshConnections()
    } catch {
      toast.error("加载连接列表失败")
    }
  }

  return (
    <header className="flex-none basis-10 overflow-hidden border-b px-2 py-2 flex items-center justify-between shrink-0">
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
          onClick={handleRefreshList}
          title="刷新连接列表"
        >
          <RefreshCw />
        </Button>
      </div>
    </header>
  )
}
