import { useSetAtom } from "jotai"
import { FilePlus2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { addTabAtom } from "@/lib/tabs"

export function EmptyPage() {
  const addTab = useSetAtom(addTabAtom)

  return (
    <div className="size-full flex flex-col items-center justify-center gap-4 select-none">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-xl border bg-muted/30 p-4 text-muted-foreground/50">
          <FilePlus2 className="size-10 stroke-[1.25]" />
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">暂无打开的查询</p>
          <p className="text-xs text-muted-foreground">
            新建一个查询标签页以开始编写 SQL
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => addTab()}
      >
        <FilePlus2 className="size-3.5" />
        新建查询
      </Button>

      <p className="text-[11px] text-muted-foreground/50 mt-1">
        也可以点击标签栏右侧的
        <kbd className="mx-1 inline-flex items-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
          +
        </kbd>
        按钮新建
      </p>
    </div>
  )
}
