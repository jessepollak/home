import * as React from "react"
import { cn } from "cn"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center rounded-sm border-b border-border bg-muted px-1 font-sans text-xs leading-none font-medium whitespace-nowrap text-foreground select-none in-data-[slot=badge]:border-transparent in-data-[slot=badge]:bg-primary-foreground in-data-[slot=badge]:text-primary",
        className
      )}
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
