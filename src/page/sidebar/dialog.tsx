import { zodResolver } from "@hookform/resolvers/zod"
import { useSetAtom } from "jotai"
import { Database, KeyRound, LockKeyhole, Server } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { type UseFormReturn, useForm } from "react-hook-form"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { FormField, FormInput } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Config, CreateConfig, DbDriver, SshAuth } from "@/lib/conn"
import connApi, { refreshConnectionsAtom } from "@/lib/conn/renderer"
import { cn } from "@/lib/utils"
import z from "@/lib/zod"

type SshAuthType = "password" | "privateKey"

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

const schema = z
  .object({
    driver: z.enum(["postgres", "mysql"]),
    name: z.string().trim().min(1, "连接名称不能为空"),
    host: z.string(),
    port: z.string(),
    username: z.string().trim().min(1, "数据库账号不能为空"),
    password: z.string().min(1, "数据库密码不能为空"),
    database: z.string().trim().min(1, "库名不能为空"),
    ssh: z.object({
      host: z.string(),
      port: z.string(),
      username: z.string(),
      authType: z.enum(["password", "privateKey"] satisfies [
        SshAuthType,
        SshAuthType,
      ]),
      secret: z.string(),
    }),
  })
  .superRefine((data, ctx) => {
    const sshState = getSshState(data.ssh)
    if (!sshState.hasConfig) {
      return
    }

    const requiredFields = [
      ["host", "SSH 主机不能为空"],
      ["port", "SSH 端口不能为空"],
      ["username", "SSH 账号不能为空"],
    ] as const

    for (const [field, message] of requiredFields) {
      if (data.ssh[field].trim()) {
        continue
      }

      ctx.addIssue({
        code: "custom",
        path: ["ssh", field],
        message,
      })
    }

    if (
      data.ssh.authType === "password" &&
      data.ssh.secret.trim().length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ssh", "secret"],
        message: "SSH 密码不能为空",
      })
    }
  })

type Schema = z.infer<typeof schema>
type ConnDialogMode = "create" | "edit"
type ConnForm = UseFormReturn<Schema>

function getDriverDefaults(driver: DbDriver) {
  if (driver === "mysql") {
    return {
      host: "127.0.0.1",
      port: "3306",
    }
  }

  return {
    host: "127.0.0.1",
    port: "5432",
  }
}

function getDefaultSshValues(auth?: SshAuth): Schema["ssh"] {
  return {
    host: "",
    port: "22",
    username: "",
    authType: auth?.type ?? "privateKey",
    secret:
      auth?.type === "password"
        ? auth.password
        : auth?.type === "privateKey"
          ? (auth.passphrase ?? "")
          : "",
  }
}

function getDefaultValues(conn?: Config | null): Schema {
  return {
    name: conn?.name ?? "新连接",
    driver: conn?.driver ?? "postgres",
    host: conn?.host ?? "",
    port: conn?.port ?? "",
    username: conn?.username ?? "",
    password: conn?.password ?? "",
    database: conn?.database ?? "",
    ssh: {
      ...getDefaultSshValues(conn?.ssh?.auth),
      host: conn?.ssh?.host ?? "",
      port: conn?.ssh?.port ?? "22",
      username: conn?.ssh?.username ?? "",
    },
  }
}

function getSshState(values: Schema["ssh"]) {
  const fields = [values.host, values.port, values.username, values.secret]
  const hasConfig = fields.some((value) => value.trim().length > 0)

  if (!hasConfig) {
    return {
      hasConfig: false,
      complete: false,
    }
  }

  const baseComplete =
    values.host.trim().length > 0 && values.port.trim().length > 0

  const authComplete =
    values.authType === "password" ? values.secret.trim().length > 0 : true

  return {
    hasConfig: true,
    complete: baseComplete && authComplete,
  }
}

function toSshAuth(data: Schema["ssh"]): SshAuth {
  if (data.authType === "password") {
    return {
      type: "password",
      password: data.secret,
    }
  }

  return {
    type: "privateKey",
    passphrase: data.secret.trim() || undefined,
  }
}

function toCreateConfig(data: Schema): CreateConfig {
  const defaults = getDriverDefaults(data.driver)
  const sshState = getSshState(data.ssh)

  return {
    name: data.name.trim(),
    driver: data.driver,
    host: data.host.trim() || defaults.host,
    port: data.port.trim() || defaults.port,
    username: data.username.trim(),
    password: data.password,
    database: data.database.trim(),
    ssh: sshState.hasConfig
      ? {
          host: data.ssh.host.trim(),
          port: data.ssh.port.trim() || "22",
          username: data.ssh.username.trim(),
          auth: toSshAuth(data.ssh),
        }
      : undefined,
  }
}

export function ConnDialog({
  mode,
  conn,
  onClose,
  onSaved,
}: {
  mode: ConnDialogMode | null
  conn?: Config | null
  onClose: () => void
  onSaved?: (conn: Config) => void
}) {
  const open = mode !== null
  const refreshConnections = useSetAtom(refreshConnectionsAtom)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(conn),
  })

  useEffect(() => {
    form.reset(getDefaultValues(mode === "edit" ? conn : null))
  }, [conn, form, mode])

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset(getDefaultValues(mode === "edit" ? conn : null))
      setSaving(false)
      setTesting(false)
      onClose()
    }
  }

  const save = async (data: Schema) => {
    setSaving(true)

    try {
      const payload = toCreateConfig(data)
      const saved =
        mode === "edit" && conn
          ? await connApi.update(conn.id, payload)
          : await connApi.create(payload)

      try {
        await refreshConnections()
      } catch {
        toast.error("刷新连接列表失败")
        return
      }

      toast.success(mode === "edit" ? "连接已更新" : "连接已保存")
      close(false)
      onSaved?.(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    const valid = await form.trigger()
    if (!valid) {
      return
    }

    setTesting(true)

    try {
      const payload = toCreateConfig(form.getValues())
      await connApi.test(payload)
      toast.success("连接测试成功")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接测试失败")
    } finally {
      setTesting(false)
    }
  }

  const formId = useId()
  const driver = form.watch("driver")
  const sshValues = form.watch("ssh")
  const sshState = getSshState(sshValues)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑连接" : "新连接"}</DialogTitle>
        </DialogHeader>

        <ScrollArea viewportClassName="p-3">
          <form id={formId} onSubmit={form.handleSubmit(save)}>
            <FieldGroup>
              <FormInput
                name="driver"
                label="数据库"
                errors={[form.formState.errors.driver]}
              >
                <DriverChoiceGroup
                  value={driver}
                  onChange={(value) => form.setValue("driver", value)}
                />
              </FormInput>

              <FormField control={form.control} name="name" label="连接名称">
                {(fProps) => <Input {...fProps.field} />}
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
            disabled={saving || testing}
          >
            {testing ? "测试中..." : "测试连接"}
          </Button>

          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline">取消</Button>} />
            <Button type="submit" form={formId} disabled={saving || testing}>
              {saving ? "保存中..." : "保存"}
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
          {(fProps) => <Input {...fProps.field} placeholder={defaults.host} />}
        </FormField>
        <FormField control={props.form.control} name="port" label="数据库端口">
          {(fProps) => <Input {...fProps.field} placeholder={defaults.port} />}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={props.form.control}
          name="username"
          label="数据库账号"
        >
          {(fProps) => <Input {...fProps.field} />}
        </FormField>
        <FormField
          control={props.form.control}
          name="password"
          label="数据库密码"
        >
          {(fProps) => <Input {...fProps.field} type="password" />}
        </FormField>
      </div>

      <FormField control={props.form.control} name="database" label="库名">
        {(fProps) => <Input {...fProps.field} />}
      </FormField>
    </FieldSet>
  )
}

function SSHPanel(props: { form: ConnForm }) {
  const authType = props.form.watch("ssh.authType")
  const secretLabel = authType === "password" ? "SSH 密码" : "私钥口令"
  const secretDescription =
    authType === "password"
      ? "密码模式下会优先使用 password，并回退到 keyboard-interactive。"
      : "私钥模式下，当前版本会先尝试本地 SSH 配置骨架，随后回退到默认私钥文件。"

  return (
    <FieldSet className="rounded-xl border p-5">
      <FieldLegend>SSH 隧道</FieldLegend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={props.form.control}
          name="ssh.host"
          label="SSH 主机"
        >
          {(fProps) => <Input {...fProps.field} />}
        </FormField>
        <FormField
          control={props.form.control}
          name="ssh.port"
          label="SSH 端口"
        >
          {(fProps) => <Input {...fProps.field} placeholder="22" />}
        </FormField>
      </div>

      <FormField
        control={props.form.control}
        name="ssh.username"
        label="SSH 账号"
      >
        {(fProps) => <Input {...fProps.field} />}
      </FormField>

      <FormInput
        name="ssh.authType"
        label="认证方式"
        description="当前版本支持 SSH 密码和私钥认证两种方式。"
        errors={[props.form.formState.errors.ssh?.authType]}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {sshAuthOptions.map((option) => {
            const active = authType === option.value
            const Icon = option.icon

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-accent/40",
                )}
                onClick={() =>
                  props.form.setValue("ssh.authType", option.value)
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{option.label}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </button>
            )
          })}
        </div>
      </FormInput>

      <FormField
        control={props.form.control}
        name="ssh.secret"
        label={secretLabel}
        description={secretDescription}
      >
        {(fProps) => <Input {...fProps.field} type="password" />}
      </FormField>

      <FieldDescription>
        只要 SSH 字段中任意一项有值，就会按 SSH 隧道方式连接数据库。
      </FieldDescription>
    </FieldSet>
  )
}

function DriverChoiceGroup(props: {
  value: DbDriver
  onChange: (value: DbDriver) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {driverOptions.map((option) => {
        const active = props.value === option.value
        const Icon = option.icon

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              active
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-accent/40",
            )}
            onClick={() => props.onChange(option.value)}
          >
            <div className="flex items-center gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{option.label}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
