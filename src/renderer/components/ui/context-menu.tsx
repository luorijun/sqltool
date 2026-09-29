import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react"

// Base UI shares menu popup and item primitives between both entry points.
export {
  DropdownMenuContent as ContextMenuContent,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuSeparator as ContextMenuSeparator,
} from "./dropdown-menu"

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
