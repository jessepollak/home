"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "cn"

type ProgressProps = Omit<
  ProgressPrimitive.Root.Props,
  "children" | "min" | "format" | "getAriaValueText" | "aria-valuetext" | "value" | "max"
> & {
  label: React.ReactNode
  value: number | null
  max: number
}

function Progress({ className, label, value, max, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
      value={value}
      max={max}
      min={0}
      getAriaValueText={value === null ? undefined : () => `${value} of ${max}`}
    >
      <div className="flex items-center justify-between gap-4 text-sm leading-5">
        <ProgressPrimitive.Label data-slot="progress-label" className="text-foreground">
          {label}
        </ProgressPrimitive.Label>
        {value !== null && (
          <ProgressPrimitive.Value data-slot="progress-value" dir="auto" className="tabular-nums text-muted-foreground">
            {() => `${value} of ${max}`}
          </ProgressPrimitive.Value>
        )}
      </div>
      <ProgressPrimitive.Track data-slot="progress-track" className="relative h-1 w-full rounded-full bg-muted">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="absolute start-0 h-full rounded-full bg-primary transition-[width] duration-300 ease-out data-indeterminate:w-full data-indeterminate:opacity-50 data-indeterminate:motion-safe:animate-pulse motion-reduce:transition-none"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

/** @public rendered by Storybook story components/ui/progress.stories.tsx */
export { Progress }
