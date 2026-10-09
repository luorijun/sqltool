import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { drain } from "@tests/support/async"
import { config, renderer } from "@tests/support/renderer"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { toast } from "sonner"
import type { Config } from "@/core/database"
import type { ConnResponse } from "@/preload/bridge"
import { useConnDialog } from "@/renderer/app/sidebar/dialog"
import { getDefaultValues } from "@/renderer/app/sidebar/form"

let env: ReturnType<typeof renderer>
let success: ReturnType<typeof spyOn<typeof toast, "success">>
let error: ReturnType<typeof spyOn<typeof toast, "error">>

beforeEach(() => {
  env = renderer(100)
  success = spyOn(toast, "success").mockReturnValue(0)
  error = spyOn(toast, "error").mockReturnValue(0)
})

afterEach(() => {
  success.mockRestore()
  error.mockRestore()
  env.restore()
})

function editor(mode: "create" | "edit" = "edit") {
  let dialog: ReturnType<typeof useConnDialog> | undefined
  let closed = 0
  function Probe() {
    dialog = useConnDialog({ mode, conn: config, onClose: () => closed++ })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!dialog) throw new Error("Missing dialog callbacks")
  return { ...dialog, closed: () => closed }
}

test("a closed editor's save cannot close a new editor or unlock its pending save", async () => {
  const old = Promise.withResolvers<ConnResponse<Config>>()
  const current = Promise.withResolvers<ConnResponse<Config>>()
  const update = spyOn(env.bridge, "update").mockReturnValue(old.promise)
  const create = spyOn(env.bridge, "create").mockReturnValue(current.promise)
  const first = editor()
  const oldSave = first.save(getDefaultValues(config))
  expect(update).toHaveBeenCalledWith(
    config.id,
    expect.objectContaining({ database: "db" }),
  )
  first.close(false)
  const second = editor("create")
  expect(second.form.getValues("username")).toBe("")
  const values = { ...getDefaultValues(config), name: "new" }
  const newSave = second.save(values)

  old.resolve(env.ok(config))
  await oldSave
  expect(first.closed()).toBe(1)
  expect(second.closed()).toBe(0)
  expect(success).not.toHaveBeenCalled()
  await second.save(values)
  expect(create).toHaveBeenCalledTimes(1)

  current.resolve(env.ok({ ...config, id: "new", name: "new" }))
  await newSave
  expect(second.closed()).toBe(1)
  expect(success).toHaveBeenCalledWith("连接已保存")
  expect(error).not.toHaveBeenCalled()
})

test("a closed editor's failed test has no stale feedback and does not affect the new test", async () => {
  const old = Promise.withResolvers<void>()
  const current = Promise.withResolvers<void>()
  const request = spyOn(env.bridge, "test")
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise)
  const first = editor()
  const oldTest = first.test()
  await drain()
  expect(request).toHaveBeenCalledTimes(1)
  first.close(false)
  const second = editor()
  const newTest = second.test()
  await drain()
  expect(request).toHaveBeenCalledTimes(2)

  old.reject(new Error("old failure"))
  await oldTest
  expect(error).not.toHaveBeenCalled()
  await second.test()
  expect(request).toHaveBeenCalledTimes(2)
  current.resolve()
  await newTest
  expect(success).toHaveBeenCalledWith("连接测试成功")
  expect(second.closed()).toBe(0)
})

test("closing during validation prevents a later test request", async () => {
  const first = editor()
  const validation = Promise.withResolvers<boolean>()
  spyOn(first.form, "trigger").mockReturnValue(validation.promise)
  const request = spyOn(env.bridge, "test")
  const testing = first.test()
  first.close(false)
  validation.resolve(true)
  await testing
  await first.save(getDefaultValues(config))
  expect(request).not.toHaveBeenCalled()
  expect(first.closed()).toBe(1)
  expect(success).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
})

test("invalid forms do not send tests, while active request errors allow retry", async () => {
  const first = editor("create")
  const request = spyOn(env.bridge, "test").mockRejectedValueOnce(
    new Error("connection failed"),
  )
  await first.test()
  expect(request).not.toHaveBeenCalled()
  first.form.reset(getDefaultValues(config))
  await first.test()
  expect(error).toHaveBeenCalledWith("connection failed")
  expect(first.closed()).toBe(0)
  request.mockResolvedValue(undefined)
  await first.test()
  expect(request).toHaveBeenCalledTimes(2)
  expect(success).toHaveBeenCalledWith("连接测试成功")
})
