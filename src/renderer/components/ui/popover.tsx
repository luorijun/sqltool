import { Popover as Primitive } from "@base-ui/react"
import type { ComponentProps } from "react"
import { cn } from "tailwind-variants"
import { popupStyle } from "./popup-style"

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverClose = Primitive.Close

export function PopoverContent({
  className,
  align = "start",
  ...props
}: ComponentProps<typeof Primitive.Popup> & {
  align?: "start" | "center" | "end"
}) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        sideOffset={4}
        align={align}
        className="isolate z-50 outline-none"
      >
        <Primitive.Popup
          {...props}
          data-slot="popover-content"
          className={cn(popupStyle, "p-3", className)}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

export function PopoverActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("mt-3 flex items-center justify-end gap-2", className)}
    />
  )
}
