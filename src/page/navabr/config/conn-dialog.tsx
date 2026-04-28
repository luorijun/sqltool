import { zodResolver } from "@hookform/resolvers/zod"
import { Database, HardDrive, Server } from "lucide-react"
import { useEffect, useId } from "react"
import { useForm } from "react-hook-form"
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
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { FormField, FormInput } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Config, CreateConfig, DbDriver } from "@/lib/config"
import configApi from "@/lib/config/renderer"
import { cn } from "@/lib/utils"
import z from "@/lib/zod"

const driverOptions = [
  {
    value: "postgres",
    label: "PostgreSQL",
    icon: Database,
    available: true,
  },
  {
    value: "mysql",
    label: "MySQL",
    icon: Server,
    available: false,
  },
  {
    value: "sqlite",
    label: "SQLite",
    icon: HardDrive,
    available: false,
  },
] as const satisfies ReadonlyArray<{
  value: DbDriver
  label: string
  icon: typeof Database
  available: boolean
}>

const schema = z
  .object({
    driver: z.enum(["postgres", "mysql", "sqlite"]),
    name: z.string().nonempty(),
    host: z.string(),
    port: z.string(),
    username: z.string().nonempty(),
    password: z.string().nonempty(),
    database: z.string().nonempty(),
    sshHost: z.string(),
    sshPort: z.string(),
    sshUsername: z.string(),
    sshPassword: z.string(),
  })
  .superRefine((data, ctx) => {
    const hasSshValue = [
      data.sshHost,
      data.sshPort,
      data.sshUsername,
      data.sshPassword,
    ].some((value) => value.trim().length > 0)

    if (!hasSshValue) {
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
    host: conn?.host,
    port: conn?.port,
    username: conn?.username ?? "",
    password: conn?.password ?? "",
    database: conn?.database ?? "",
    sshHost: conn?.ssh?.host ?? "",
    sshPort: conn?.ssh?.port ?? "",
    sshUsername: conn?.ssh?.username ?? "",
    sshPassword: conn?.ssh?.password ?? "",
  }
}

function toCreateConfig(data: Schema): CreateConfig {
  const hasSshValue = [
    data.sshHost,
    data.sshPort,
    data.sshUsername,
    data.sshPassword,
  ].some((value) => value.trim().length > 0)

  return {
    name: data.name,
    driver: data.driver,
    host: data.host ?? "127.0.0.1",
    port: data.port ?? "5432",
    username: data.username,
    password: data.password,
    database: data.database,
    ssh: hasSshValue
      ? {
          host: data.sshHost,
          port: data.sshPort ?? "22",
          username: data.sshUsername,
          password: data.sshPassword,
        }
      : undefined,
  }
}

function getSshState(
  values: Pick<Schema, "sshHost" | "sshUsername" | "sshPassword">,
) {
  const sshValues = [values.sshHost, values.sshUsername, values.sshPassword]

  const filledCount = sshValues.filter(
    (value) => value.trim().length > 0,
  ).length

  if (filledCount === 0) {
    return { hasConfig: false, complete: false }
  }

  return {
    hasConfig: true,
    complete: filledCount === sshValues.length,
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
  onSaved: (conn: Config) => void
}) {
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
    console.log("Saving config with data:", data)
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

  const formId = useId()
  const driver = form.watch("driver")
  const sshHost = form.watch("sshHost")
  const sshUsername = form.watch("sshUsername")
  const sshPassword = form.watch("sshPassword")
  const sshState = getSshState({
    sshHost,
    sshUsername,
    sshPassword,
  })

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑连接" : "新连接"}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="overflow-hidden">
          <form id={formId} onSubmit={form.handleSubmit(save)}>
            <FieldGroup>
              <FormInput<Schema>
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
                  <SSHPanel
                    form={form}
                    hasConfig={sshState.hasConfig}
                    complete={sshState.complete}
                  />
                </TabsContent>
              </Tabs>
            </FieldGroup>
          </form>
        </ScrollArea>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">取消</Button>} />
          <Button type="submit" form={formId}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DatabasePanel(props: { form: ReturnType<typeof useForm<Schema>> }) {
  return (
    <FieldSet className="border rounded-xl p-5">
      <FieldLegend>数据库连接</FieldLegend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={props.form.control} name="host" label="数据库主机">
          {(fProps) => <Input {...fProps.field} placeholder="127.0.0.1" />}
        </FormField>
        <FormField control={props.form.control} name="port" label="数据库端口">
          {(fProps) => <Input {...fProps.field} placeholder="5432" />}
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

function SSHPanel(props: {
  form: ReturnType<typeof useForm<Schema>>
  complete: boolean
  hasConfig: boolean
}) {
  return (
    <FieldSet className="rounded-xl border p-5">
      <FieldLegend>SSH 隧道</FieldLegend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={props.form.control} name="sshHost" label="SSH 主机">
          {(fProps) => <Input {...fProps.field} />}
        </FormField>
        <FormField control={props.form.control} name="sshPort" label="SSH 端口">
          {(fProps) => <Input {...fProps.field} placeholder="22" />}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={props.form.control}
          name="sshUsername"
          label="SSH 账号"
        >
          {(fProps) => <Input {...fProps.field} />}
        </FormField>
        <FormField
          control={props.form.control}
          name="sshPassword"
          label="SSH 密码"
        >
          {(fProps) => <Input {...fProps.field} type="password" />}
        </FormField>
      </div>
    </FieldSet>
  )
}

function DriverChoiceGroup(props: {
  value: DbDriver
  onChange: (value: DbDriver) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {driverOptions.map((option) => {
        const active = props.value === option.value
        const Icon = option.icon

        return (
          <button
            key={option.value}
            type="button"
            disabled={!option.available}
            aria-pressed={active}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              active && option.available
                ? "border-primary bg-primary/5"
                : "border-border bg-card",
              option.available
                ? "hover:bg-accent/40"
                : "cursor-not-allowed opacity-55 saturate-0",
            )}
            onClick={() => {
              if (!option.available) {
                return
              }
              props.onChange(option.value)
            }}
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
