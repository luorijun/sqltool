import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import type { LucideIcon } from "lucide-react"
import { useId } from "react"
import { cn } from "tailwind-variants"

interface Choice<Value> {
  value: Value
  label: string
  description?: string
  icon: LucideIcon
}

export function ChoiceGroup<Value extends string>({
  options,
  className,
  ...props
}: RadioGroup.Props<Value> & { options: readonly Choice<Value>[] }) {
  const id = useId()
  return (
    <RadioGroup
      className={(state) =>
        cn(
          "grid gap-3 sm:grid-cols-2",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      {options.map(({ value, label, description, icon: Icon }) => (
        <Radio.Root
          key={value}
          value={value}
          render={<button type="button" />}
          nativeButton
          aria-labelledby={`${id}-${value}-label`}
          aria-describedby={
            description ? `${id}-${value}-description` : undefined
          }
          className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40 data-checked:border-primary data-checked:bg-primary/5 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <span className="flex items-center gap-3">
            <Icon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span id={`${id}-${value}-label`} className="text-sm font-medium">
              {label}
            </span>
          </span>
          {description && (
            <span
              id={`${id}-${value}-description`}
              className="mt-2 block text-xs text-muted-foreground"
            >
              {description}
            </span>
          )}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}
