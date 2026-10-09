import { zodResolver } from "@hookform/resolvers/zod"
import { Database, KeyRound, LockKeyhole, Server } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { type UseFormReturn, useForm } from "react-hook-form"
import { toast } from "sonner"
import type { Config, DbDriver } from "@/core/database"
import { Badge } from "@/renderer/components/ui/badge"
import { Button } from "@/renderer/components/ui/button"
import { ChoiceGroup } from "@/renderer/components/ui/choice-group"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog"
import {
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/renderer/components/ui/field"
import { FormField } from "@/renderer/components/ui/form"
import { Input } from "@/renderer/components/ui/input"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/renderer/components/ui/tabs"
import connApi from "@/renderer/modules/database"
import {
  getDefaultValues,
  getDriverDefaults,
  getSshState,
  type Schema,
  type SshAuthType,
  schema,
  toCreateConfig,
} from "./form"

type ConnForm = UseFormReturn<Schema>

type DialogProps = {
  mode: "create" | "edit"
  conn?: Config | null
  onClose: () => void
}

const driverOptions = [
  {
    value: "postgres",
    label: "PostgreSQL",
    icon: Database,
  },
  {
    value: "mysql",
    label: "MySQL / MariaDB",
    icon: Server,
  },
] as const satisfies ReadonlyArray<{
  value: DbDriver
  label: string
  icon: typeof Database
}>

const sshAuthOptions = [
  {
    value: "password",
    label: "密码",
    description: "使用 SSH 密码或 keyboard-interactive 方式认证。",
    icon: LockKeyhole,
  },
  {
    value: "privateKey",
    label: "私钥",
    description: "通过本地 SSH 配置、agent 或默认私钥文件解析认证信息。",
    icon: KeyRound,
  },
] as const satisfies ReadonlyArray<{
  value: SshAuthType
  label: string
  description: string
  icon: typeof KeyRound
}>

export function useConnDialog({ mode, conn, onClose }: DialogProps) {
  const active = useRef(true)
  const pending = useRef(false)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(mode === "edit" ? conn : null),
  })

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const close = (nextOpen: boolean) => {
    if (nextOpen || !active.current) return
    active.current = false
    onClose()
  }

  const run = async (
    action: "save" | "test",
    operation: () => Promise<void>,
  ) => {
    if (!active.current || pending.current) return
    pending.current = true
    setBusy(action)
    try {
      await operation()
    } catch (error) {
      if (active.current)
        toast.error(
          error instanceof Error
            ? error.message
            : action === "save"
              ? "保存失败"
              : "连接测试失败",
        )
    } finally {
      pending.current = false
      if (active.current) setBusy(null)
    }
  }

  const save = (data: Schema) =>
    run("save", async () => {
      const payload = toCreateConfig(data)
      if (mode === "edit" && conn) await connApi.update(conn.id, payload)
      else await connApi.create(payload)
      if (!active.current) return
      toast.success(mode === "edit" ? "连接已更新" : "连接已保存")
      close(false)
    })

  const test = () =>
    run("test", async () => {
      const valid = await form.trigger()
      if (!valid || !active.current) return
      await connApi.test(toCreateConfig(form.getValues()))
      if (active.current) toast.success("连接测试成功")
    })

  return { form, busy, close, save, test }
}

export function ConnDialog(props: DialogProps) {
  const { form, busy, close, save, test } = useConnDialog(props)
  const formId = useId()
  const sshValues = form.watch("ssh")
  const sshState = getSshState(sshValues)

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "edit" ? "编辑连接" : "新连接"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea viewportClassName="p-3">
          <form id={formId} onSubmit={form.handleSubmit(save)}>
            <FieldGroup>
              <FormField
                control={form.control}
                name="driver"
                label="数据库"
                group
              >
                {({ field }) => (
                  <ChoiceGroup
                    options={driverOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                  />
                )}
              </FormField>

              <FormField control={form.control} name="name" label="连接名称">
                {({ field: { onChange, ...field } }) => (
                  <Input {...field} onValueChange={onChange} />
                )}
              </FormField>

              <Tabs defaultValue="database">
                <TabsList className="h-12">
                  <TabsTrigger className="px-5" value="database">
                    数据库连接
                  </TabsTrigger>

                  <TabsTrigger className="px-5" value="ssh">
                    <span>SSH 隧道</span>
                    {sshState.complete ? (
                      <Badge variant="success">启用</Badge>
                    ) : sshState.hasConfig ? (
                      <Badge variant="warning">未完成</Badge>
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="database">
                  <DatabasePanel form={form} />
                </TabsContent>

                <TabsContent value="ssh">
                  <SSHPanel form={form} />
                </TabsContent>
              </Tabs>
            </FieldGroup>
          </form>
        </ScrollArea>

        <DialogFooter className="justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={test}
            disabled={busy !== null}
          >
            {busy === "test" ? "测试中..." : "测试连接"}
          </Button>

          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline">取消</Button>} />
            <Button type="submit" form={formId} disabled={busy !== null}>
              {busy === "save" ? "保存中..." : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DatabasePanel(props: { form: ConnForm }) {
  const driver = props.form.watch("driver")
  const defaults = getDriverDefaults(driver)

  return (
    <FieldSet className="border rounded-xl p-5">
      <FieldLegend>数据库连接</FieldLegend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={props.form.control} name="host" label="数据库主机">
          {({ field: { onChange, ...field } }) => (
            <Input
              {...field}
              onValueChange={onChange}
              placeholder={defaults.host}
            />
          )}
        </FormField>
        <FormField control={props.form.control} name="port" label="数据库端口">
          {({ field: { onChange, ...field } }) => (
            <Input
              {...field}
              onValueChange={onChange}
              placeholder={defaults.port}
            />
          )}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={props.form.control}
          name="username"
          label="数据库账号"
        >
          {({ field: { onChange, ...field } }) => (
            <Input {...field} onValueChange={onChange} />
          )}
        </FormField>
        <FormField
          control={props.form.control}
          name="password"
          label="数据库密码"
        >
          {({ field: { onChange, ...field } }) => (
            <Input {...field} onValueChange={onChange} type="password" />
          )}
        </FormField>
      </div>

      <FormField control={props.form.control} name="database" label="库名">
        {({ field: { onChange, ...field } }) => (
          <Input {...field} onValueChange={onChange} />
        )}
      </FormField>
    </FieldSet>
  )
}

function SSHPanel(props: { form: ConnForm }) {
  const authType = props.form.watch("ssh.authType")
  const secretLabel = authType === "password" ? "SSH 密码" : "私钥口令"

  return (
    <FieldSet className="rounded-xl border p-5">
      <FieldLegend>SSH 隧道</FieldLegend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={props.form.control}
          name="ssh.host"
          label="SSH 主机"
        >
          {({ field: { onChange, ...field } }) => (
            <Input {...field} onValueChange={onChange} />
          )}
        </FormField>
        <FormField
          control={props.form.control}
          name="ssh.port"
          label="SSH 端口"
        >
          {({ field: { onChange, ...field } }) => (
            <Input {...field} onValueChange={onChange} placeholder="22" />
          )}
        </FormField>
      </div>

      <FormField
        control={props.form.control}
        name="ssh.username"
        label="SSH 账号"
      >
        {({ field: { onChange, ...field } }) => (
          <Input {...field} onValueChange={onChange} />
        )}
      </FormField>

      <FormField
        control={props.form.control}
        name="ssh.authType"
        label="认证方式"
        group
      >
        {({ field }) => (
          <ChoiceGroup
            options={sshAuthOptions}
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
          />
        )}
      </FormField>

      <FormField
        control={props.form.control}
        name="ssh.secret"
        label={secretLabel}
      >
        {({ field: { onChange, ...field } }) => (
          <Input {...field} onValueChange={onChange} type="password" />
        )}
      </FormField>
    </FieldSet>
  )
}
