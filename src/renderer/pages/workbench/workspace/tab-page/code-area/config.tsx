import { useAtomValue } from "jotai"
import { ChevronDown, Database } from "lucide-react"
import { Button } from "@/renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
import { connectionEntriesAtom } from "@/renderer/modules/database"

interface CodeConfigProps {
  configId?: string
  status?: string
  disabled?: boolean
  onChange?: (configId?: string) => void
}

export default function CodeConfig({
  configId,
  status,
  disabled,
  onChange,
}: CodeConfigProps) {
  const connections = useAtomValue(connectionEntriesAtom)
  const config = connections?.find(
    (entry) => entry.config.id === configId,
  )?.config
  const label = config
    ? config.name || config.database
    : configId
      ? connections === null
        ? "配置加载中"
        : "配置已删除"
      : "绑定配置"
  const detail = config
    ? `${config.name || config.database} · ${config.database} · ${config.host}:${config.port}`
    : label
  const title = [detail, status].filter(Boolean).join("\n")
  const content = (
    <>
      <Database className="size-3 shrink-0" />
      <span className="max-w-36 truncate">{label}</span>
    </>
  )

  if (!onChange) {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground"
        title={`${title}\n只读查询，不可修改绑定配置`}
      >
        {content}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || connections === null}
            title={title}
            aria-label={`绑定配置：${label}`}
            className="gap-1.5 shrink-0 text-muted-foreground"
          />
        }
      >
        {content}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={configId ?? ""}
          onValueChange={(value) => onChange(value || undefined)}
        >
          <DropdownMenuRadioItem value="" disabled={disabled}>
            未绑定配置
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {connections?.map(({ config: item }) => (
            <DropdownMenuRadioItem
              key={item.id}
              value={item.id}
              disabled={disabled}
            >
              <div className="min-w-0">
                <div className="truncate">{item.name || item.database}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.database} · {item.host}:{item.port}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {connections?.length === 0 && (
          <DropdownMenuItem disabled>
            暂无配置，请先在侧边栏添加连接
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
