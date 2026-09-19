"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  children,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // Keep the painted track and thumb compact (28px) while the invisible
        // `::before` extends the tappable area to 44px on touch layouts. Only
        // desktop-sized fine-pointer devices remove the extension. The pseudo
        // element is inset relative to the 26px padding box (28px minus the 1px
        // borders), so it needs a 9px overhang on each side.
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-input bg-input p-1 transition-colors outline-none before:absolute before:inset-x-0 before:-inset-y-2.25 before:content-[''] md:pointer-fine:before:content-none data-checked:border-primary data-checked:bg-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-5 motion-reduce:transition-none"
      />
      {children}
    </SwitchPrimitive.Root>
  )
}

export { Switch }
