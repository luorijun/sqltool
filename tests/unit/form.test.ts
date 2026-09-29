import { expect, test } from "bun:test"
import { zodResolver } from "@hookform/resolvers/zod"
import { createFormControl } from "react-hook-form"
import { schema } from "../../src/renderer/pages/workbench/sidebar/dialog"

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
