import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const kbdVariants = cva(
  "pointer-events-none inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center rounded-sm px-1 font-sans text-xs leading-none font-medium whitespace-nowrap select-none",
  {
    variants: {
      variant: {
        default:
          "border-b border-border bg-muted text-foreground in-data-[slot=badge]:border-transparent in-data-[slot=badge]:bg-primary-foreground in-data-[slot=badge]:text-primary",
        inverse: "bg-primary-foreground/20 text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Kbd({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) {
  return (
    <kbd
      data-slot="kbd"
      data-variant={variant}
      className={cn(kbdVariants({ variant }), className)}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
