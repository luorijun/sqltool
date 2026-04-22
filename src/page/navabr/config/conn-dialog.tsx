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
import { FieldGroup } from "@/components/ui/field"
import { FormField } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import type { Config, CreateConfig, DbDriver } from "@/lib/config"
import configApi from "@/lib/config/renderer"
import z from "@/lib/zod"

const schema = z.object({
  name: z.string().nonempty(),
  driver: z.enum(["postgres", "mysql", "sqlite"]),
  host: z.string().nonempty(),
  port: z.string().nonempty(),
  username: z.string().nonempty(),
  password: z.string().nonempty(),
  database: z.string().nonempty(),
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
  }
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

            <FieldGroup className="flex-row">
              <FormField control={form.control} name="host" label="主机">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
              <FormField control={form.control} name="port" label="端口">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
            </FieldGroup>

            <FieldGroup className="flex-row">
              <FormField control={form.control} name="username" label="账号">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
              <FormField control={form.control} name="password" label="密码">
                {(fProps) => <Input {...fProps.field} type="password" />}
              </FormField>
            </FieldGroup>

            <FormField control={form.control} name="database" label="库名">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>
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
