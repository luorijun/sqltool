import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { FormField } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import type { Config, CreateConfig, DbDriver } from "@/lib/config"
import configApi from "@/lib/config/renderer"
import { cn } from "@/lib/utils"
import z from "@/lib/zod"

const connectionModeOptions = [
  {
    value: "direct",
    label: "直连",
    description: "直接连接数据库主机和端口",
  },
  {
    value: "ssh",
    label: "SSH 隧道",
    description: "先连接 SSH 服务器，再转发到数据库",
  },
] as const

const schema = z
  .object({
    name: z.string().nonempty(),
    driver: z.enum(["postgres", "mysql", "sqlite"]),
    host: z.string().nonempty(),
    port: z.string().nonempty(),
    username: z.string().nonempty(),
    password: z.string().nonempty(),
    database: z.string().nonempty(),
    connectionMode: z.enum(["direct", "ssh"]),
    sshHost: z.string(),
    sshPort: z.string(),
    sshUsername: z.string(),
    sshPassword: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.connectionMode !== "ssh") {
      return
    }

    const requiredFields = [
      ["sshHost", "SSH 主机不能为空"],
      ["sshPort", "SSH 端口不能为空"],
      ["sshUsername", "SSH 账号不能为空"],
      ["sshPassword", "SSH 密码不能为空"],
    ] as const

    for (const [path, message] of requiredFields) {
      if (data[path].trim()) {
        continue
      }

      ctx.addIssue({
        code: "custom",
        path: [path],
        message,
      })
    }
  })

type Schema = z.infer<typeof schema>
type ConnDialogMode = "create" | "edit"

function getDefaultValues(conn?: Config | null): Schema {
  return {
    name: conn?.name ?? "新连接",
    driver: (conn?.driver ?? "postgres") as DbDriver,
    host: conn?.host ?? "127.0.0.1",
    port: conn?.port ?? "5432",
    username: conn?.username ?? "",
    password: conn?.password ?? "",
    database: conn?.database ?? "",
    connectionMode: conn?.ssh ? "ssh" : "direct",
    sshHost: conn?.ssh?.host ?? "",
    sshPort: conn?.ssh?.port ?? "22",
    sshUsername: conn?.ssh?.username ?? "",
    sshPassword: conn?.ssh?.password ?? "",
  }
}

function toCreateConfig(data: Schema): CreateConfig {
  return {
    name: data.name,
    driver: data.driver,
    host: data.host,
    port: data.port,
    username: data.username,
    password: data.password,
    database: data.database,
    ssh:
      data.connectionMode === "ssh"
        ? {
            host: data.sshHost,
            port: data.sshPort,
            username: data.sshUsername,
            password: data.sshPassword,
          }
        : undefined,
  }
}

function ConnectionModeField(props: {
  value: Schema["connectionMode"]
  onChange: (value: Schema["connectionMode"]) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {connectionModeOptions.map((option) => {
        const active = props.value === option.value

        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "rounded-3xl border px-3 py-3 text-left transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/20 hover:bg-muted/40",
            )}
            onClick={() => props.onChange(option.value)}
          >
            <div className="text-sm font-medium">{option.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {option.description}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export interface ConnDialogProps {
  mode: ConnDialogMode | null
  conn?: Config | null
  onClose: () => void
  onSaved: (conn: Config) => void
}

export function ConnDialog({ mode, conn, onClose, onSaved }: ConnDialogProps) {
  const open = mode !== null
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(conn),
  })

  useEffect(() => {
    form.reset(getDefaultValues(mode === "edit" ? conn : null))
  }, [conn, form, mode])

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset(getDefaultValues(mode === "edit" ? conn : null))
      onClose()
    }
  }

  const save = async (data: Schema) => {
    try {
      const payload = toCreateConfig(data)
      const saved =
        mode === "edit" && conn
          ? await configApi.update(conn.id, payload)
          : await configApi.create(payload)

      toast.success(mode === "edit" ? "连接已更新" : "连接已保存")
      onSaved(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    }
  }

  const formId = mode === "edit" ? "edit-conn-form" : "create-conn-form"
  const connectionMode = form.watch("connectionMode")

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑连接" : "新连接"}</DialogTitle>
          <DialogDescription>
            {mode === "edit" ? "修改数据库连接配置" : "创建一个新的数据库连接"}
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={form.handleSubmit(save)}>
          <FieldGroup>
            <FormField control={form.control} name="name" label="连接名称">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>

            <FormField control={form.control} name="driver" label="数据库">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>

            <FormField
              control={form.control}
              name="connectionMode"
              label="连接方式"
              description="直连适用于数据库可直接访问；SSH 隧道适用于数据库只开放内网地址"
            >
              {(fProps) => (
                <ConnectionModeField
                  value={fProps.field.value as Schema["connectionMode"]}
                  onChange={(value) => fProps.field.onChange(value)}
                />
              )}
            </FormField>

            <FieldGroup className="gap-4 rounded-3xl border bg-muted/10 p-4">
              <div>
                <div className="text-sm font-medium">数据库连接</div>
                <FieldDescription className="mt-1 text-xs">
                  {connectionMode === "ssh"
                    ? "填写 SSH 服务器内可访问的数据库地址"
                    : "填写可直接访问的数据库地址"}
                </FieldDescription>
              </div>

              <FieldGroup className="flex-row">
                <FormField
                  control={form.control}
                  name="host"
                  label="数据库主机"
                >
                  {(fProps) => <Input {...fProps.field} />}
                </FormField>
                <FormField
                  control={form.control}
                  name="port"
                  label="数据库端口"
                >
                  {(fProps) => <Input {...fProps.field} />}
                </FormField>
              </FieldGroup>

              <FieldGroup className="flex-row">
                <FormField
                  control={form.control}
                  name="username"
                  label="数据库账号"
                >
                  {(fProps) => <Input {...fProps.field} />}
                </FormField>
                <FormField
                  control={form.control}
                  name="password"
                  label="数据库密码"
                >
                  {(fProps) => <Input {...fProps.field} type="password" />}
                </FormField>
              </FieldGroup>

              <FormField control={form.control} name="database" label="库名">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
            </FieldGroup>

            {connectionMode === "ssh" && (
              <FieldGroup className="gap-4 rounded-3xl border bg-muted/10 p-4">
                <div>
                  <div className="text-sm font-medium">SSH 隧道</div>
                  <FieldDescription className="mt-1 text-xs">
                    首版支持 SSH 用户名和密码登录
                  </FieldDescription>
                </div>

                <FieldGroup className="flex-row">
                  <FormField
                    control={form.control}
                    name="sshHost"
                    label="SSH 主机"
                  >
                    {(fProps) => <Input {...fProps.field} />}
                  </FormField>
                  <FormField
                    control={form.control}
                    name="sshPort"
                    label="SSH 端口"
                  >
                    {(fProps) => <Input {...fProps.field} />}
                  </FormField>
                </FieldGroup>

                <FieldGroup className="flex-row">
                  <FormField
                    control={form.control}
                    name="sshUsername"
                    label="SSH 账号"
                  >
                    {(fProps) => <Input {...fProps.field} />}
                  </FormField>
                  <FormField
                    control={form.control}
                    name="sshPassword"
                    label="SSH 密码"
                  >
                    {(fProps) => <Input {...fProps.field} type="password" />}
                  </FormField>
                </FieldGroup>
              </FieldGroup>
            )}
          </FieldGroup>
        </form>

        <DialogFooter className="flex justify-between">
          <DialogClose render={<Button variant="outline">取消</Button>} />
          <Button type="submit" form={formId}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
