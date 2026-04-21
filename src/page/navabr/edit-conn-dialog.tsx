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
import z from "@/lib/zod"
import type { Config } from "../../lib/config/index"
import config from "../../lib/config/renderer"

// ─── Schema ──────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export interface EditConnDialogProps {
  conn: Config | null
  onClose: () => void
  onSaved: (conn: Config) => void
}

export function EditConnDialog({
  conn,
  onClose,
  onSaved,
}: EditConnDialogProps) {
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (conn) {
      form.reset({
        name: conn.name ?? "",
        driver: conn.driver,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        database: conn.database,
      })
    }
  }, [conn, form])

  const save = async (data: Schema) => {
    if (!conn) return
    try {
      const updated = await config.update(conn.id, data)
      toast.success("连接已更新")
      onSaved(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败")
    }
  }

  const formId = "edit-conn-form"

  return (
    <Dialog open={conn !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑连接</DialogTitle>
          <DialogDescription>修改数据库连接配置</DialogDescription>
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
