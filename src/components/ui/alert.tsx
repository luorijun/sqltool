import { cva, type VariantProps } from "class-variance-authority"
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative flex gap-3 rounded-xl border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        info: "border-primary/20 bg-primary/5 text-foreground",
        success: "border-emerald-500/20 bg-emerald-500/5 text-foreground",
        warning: "border-amber-500/20 bg-amber-500/5 text-foreground",
        destructive: "border-destructive/20 bg-destructive/5 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      data-slot="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  )
}

function AlertIcon({
  className,
  variant = "default",
}: {
  className?: string
  variant?: NonNullable<VariantProps<typeof alertVariants>["variant"]>
}) {
  const iconClassName = cn("mt-0.5 size-4 shrink-0", className)

  switch (variant) {
    case "success":
      return <CheckCircle2 className={iconClassName} />
    case "warning":
      return <TriangleAlert className={iconClassName} />
    case "destructive":
      return <AlertCircle className={iconClassName} />
    default:
      return <Info className={iconClassName} />
  }
}

function AlertContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium leading-none", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  )
}

export {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  alertVariants,
}
