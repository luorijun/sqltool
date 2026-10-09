import { expect, test } from "bun:test"
import { zodResolver } from "@hookform/resolvers/zod"
import { config } from "@tests/support/config"
import { createFormControl } from "react-hook-form"
import {
  getDefaultValues,
  getSshState,
  schema,
  toCreateConfig,
} from "@/renderer/app/sidebar/form"

test("connection form validates nested SSH fields and clears errors after reset", async () => {
  const defaults = {
    driver: "postgres" as const,
    name: "test",
    host: "",
    port: "",
    username: "user",
    password: "password",
    database: "test",
    ssh: {
      host: "",
      port: "",
      username: "",
      authType: "password" as const,
      secret: "",
    },
  }
  const form = createFormControl({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  form.register("name")
  form.register("ssh.host")
  form.register("ssh.username")
  form.register("ssh.secret")
  const unsubscribe = form.subscribe({
    formState: { errors: true, values: true },
    callback: () => {},
  })
  try {
    expect(await form.trigger()).toBe(true)
    form.setValue("ssh.host", "bastion")
    expect(await form.trigger()).toBe(false)
    expect(form.getFieldState("ssh.username").error?.message).toBe(
      "SSH 账号不能为空",
    )
    expect(form.getFieldState("ssh.secret").error?.message).toBe(
      "SSH 密码不能为空",
    )
    form.reset(defaults)
    expect(form.getValues("ssh.host")).toBe("")
    expect(form.getFieldState("ssh.username").error).toBeUndefined()
    expect(await form.trigger()).toBe(true)
    form.setValue("name", "  trimmed  ")
    let name = ""
    await form.handleSubmit((values) => {
      name = values.name
    })()
    expect(name).toBe("trimmed")
  } finally {
    unsubscribe()
  }
})

test("connection defaults and payloads keep driver fallbacks and secret whitespace", () => {
  const values = {
    ...getDefaultValues(),
    driver: "mysql" as const,
    name: "  local  ",
    host: " ",
    port: " ",
    username: " user ",
    password: " password ",
    database: " data ",
  }
  expect(toCreateConfig(schema.parse(values))).toEqual({
    driver: "mysql",
    name: "local",
    host: "127.0.0.1",
    port: "3306",
    username: "user",
    password: " password ",
    database: "data",
    ssh: undefined,
  })
  expect(toCreateConfig({ ...values, driver: "postgres" }).port).toBe("5432")
  expect(getSshState(values.ssh)).toEqual({ hasConfig: false, complete: false })
})

test("SSH form values restore both authentication modes and preserve omitted private-key fields", () => {
  for (const auth of [
    { type: "password" as const, password: " secret " },
    { type: "privateKey" as const, passphrase: "phrase" },
  ]) {
    const ssh = { host: "bastion", port: "", username: "ssh-user", auth }
    const values = getDefaultValues({ ...config, ssh })
    expect(getSshState(values.ssh)).toEqual({ hasConfig: true, complete: true })
    expect(toCreateConfig(schema.parse(values)).ssh).toEqual(ssh)
  }
  const values = getDefaultValues(config)
  values.ssh.host = " bastion "
  expect(schema.safeParse(values).success).toBe(true)
  expect(toCreateConfig(values).ssh).toEqual({
    host: "bastion",
    port: "",
    username: "",
    auth: { type: "privateKey", passphrase: undefined },
  })
  values.ssh.authType = "password"
  expect(getSshState(values.ssh).complete).toBe(false)
  expect(schema.safeParse(values).success).toBe(false)
})
