import { z } from "zod"
import { zhCN } from "zod/locales"
import type { Config, DbDriver, SshAuth } from "@/core/database"
import type { CreateConfig } from "@/preload/bridge"

z.config(zhCN())

export type SshAuthType = "password" | "privateKey"

export const schema = z
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

    const requiredFields =
      data.ssh.authType === "password"
        ? ([
            ["host", "SSH 主机不能为空"],
            ["username", "SSH 账号不能为空"],
          ] as const)
        : ([["host", "SSH 主机不能为空"]] as const)

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

export type Schema = z.infer<typeof schema>

export function getDriverDefaults(driver: DbDriver) {
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
    port: "",
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

export function getDefaultValues(conn?: Config | null): Schema {
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
      port: conn?.ssh?.port ?? "",
      username: conn?.ssh?.username ?? "",
    },
  }
}

export function getSshState(values: Schema["ssh"]) {
  const fields = [values.host, values.port, values.username, values.secret]
  const hasConfig = fields.some((value) => value.trim().length > 0)

  if (!hasConfig) {
    return {
      hasConfig: false,
      complete: false,
    }
  }

  if (values.authType === "privateKey") {
    return {
      hasConfig: true,
      complete: values.host.trim().length > 0,
    }
  }

  return {
    hasConfig: true,
    complete:
      values.host.trim().length > 0 &&
      values.username.trim().length > 0 &&
      values.secret.trim().length > 0,
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

export function toCreateConfig(data: Schema): CreateConfig {
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
          port: data.ssh.port.trim(),
          username: data.ssh.username.trim(),
          auth: toSshAuth(data.ssh),
        }
      : undefined,
  }
}
