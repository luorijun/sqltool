import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { FormField } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import connection from "@/lib/connection/renderer"
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

export default function NewConn({ onSaved }: { onSaved?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      driver: "postgres" as const,
      host: "127.0.0.1",
      port: "5432",
      username: "",
      password: "",
      database: "",
    },
  })

  const save = async (data: Schema) => {
    try {
      await connection.create(data)
      toast.success("连接已保存")
      toggleDialog(false)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    }
  }

  const toggleDialog = (v: boolean) => {
    setOpen(v)
    if (!v) form.reset()
  }

  const formId = "new-conn-form"

  return (
    <Dialog open={open} onOpenChange={toggleDialog}>
      <DialogTrigger className={buttonVariants()}>新连接</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新连接</DialogTitle>
          <DialogDescription>创建一个新的数据库连接</DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={form.handleSubmit(save)}>
          <FieldGroup>
            <FormField control={form.control} name="name" label="连接名称">
              {(fProps) => <Input {...fProps.field} defaultValue="新连接" />}
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
