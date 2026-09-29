import { expect, test } from "bun:test"
import { Database, Server } from "lucide-react"
import { renderToStaticMarkup } from "react-dom/server"
import { useForm } from "react-hook-form"
import { ChoiceGroup } from "../../src/renderer/components/ui/choice-group"
import { FormField } from "../../src/renderer/components/ui/form"
import { Input } from "../../src/renderer/components/ui/input"

test("form fields associate labels with inputs and expose resolver errors", () => {
  function Form() {
    const form = useForm({
      defaultValues: { name: "" },
      errors: { name: { type: "required", message: "连接名称不能为空" } },
    })
    return (
      <FormField
        control={form.control}
        name="name"
        label="连接名称"
        description="用于区分连接"
      >
        {({ field: { onChange, ...field } }) => (
          <Input
            {...field}
            onValueChange={onChange}
            className={(state) =>
              state.valid === false ? "invalid-control" : "valid-control"
            }
          />
        )}
      </FormField>
    )
  }
  const html = renderToStaticMarkup(<Form />)
  const label = html.match(/<label\b[^>]*\bfor="([^"]+)"/)
  expect(label).not.toBeNull()
  const input = html.match(/<input\b[^>]*>/)?.[0]
  expect(input).toContain(`id="${label?.[1]}"`)
  expect(input).toContain('name="name"')
  expect(input).toContain('aria-invalid="true"')
  expect(input).toContain("invalid-control")
  expect(html).toContain("用于区分连接")
  expect(html).toContain('role="alert"')
  expect(html).toContain("连接名称不能为空")
})

test("choice fields retain a single controlled radio selection", () => {
  function Form() {
    const form = useForm<{ driver: "postgres" | "mysql" }>({
      defaultValues: { driver: "mysql" },
    })
    return (
      <FormField control={form.control} name="driver" label="数据库" group>
        {({ field }) => (
          <ChoiceGroup
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={[
              { value: "postgres", label: "PostgreSQL", icon: Database },
              { value: "mysql", label: "MySQL", icon: Server },
            ]}
          />
        )}
      </FormField>
    )
  }
  const html = renderToStaticMarkup(<Form />)
  expect(html).toContain('role="radiogroup"')
  expect(html.match(/role="radio"/g)).toHaveLength(2)
  expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  expect(html).toMatch(/<input\b[^>]*checked=""[^>]*value="mysql"/)
  expect(html.match(/name="driver"/g)).toHaveLength(2)
})
