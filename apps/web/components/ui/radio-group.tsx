"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { cn } from "cn"

function RadioGroup({ className, variant, ...props }: RadioGroupPrimitive.Props & { variant?: "segmented" }) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      data-variant={variant}
      className={cn(
        variant === "segmented" ? "flex w-full min-w-0 items-stretch rounded-lg border border-input p-0.5" : "grid gap-2",
        className,
      )}
      {...props}
    />
  )
}

function RadioGroupItem({ className, children, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background outline-none data-checked:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-disabled:cursor-not-allowed data-disabled:opacity-50 group-has-data-disabled/radio-option:opacity-100 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-primary" />
      {children}
    </RadioPrimitive.Root>
  )
}

function RadioGroupSegment({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-segment"
      className={cn(
        "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-muted data-checked:text-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  )
}

type RadioGroupOptionProps = {
  value: string
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
  invalid?: boolean
  id?: string
}

function RadioGroupOption({ value, label, description, disabled, invalid, id }: RadioGroupOptionProps) {
  const generatedId = React.useId()
  const itemId = id ?? generatedId
  const labelId = `${itemId}-label`
  const descriptionId = `${itemId}-description`

  return (
    <label
      data-slot="radio-group-option"
      htmlFor={itemId}
      className={cn(
        "group/radio-option flex min-h-11 w-full cursor-pointer items-center gap-2.5 text-sm text-foreground has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50",
        description != null && "items-start"
      )}
    >
      <RadioGroupItem id={itemId} value={value} disabled={disabled} aria-invalid={invalid || undefined} aria-labelledby={labelId} aria-describedby={description != null ? descriptionId : undefined} className={description != null ? "mt-0.5" : undefined} />
      <span className="flex flex-col gap-0.5 leading-snug">
        <span id={labelId}>{label}</span>
        {description != null ? <span id={descriptionId} className="text-sm text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  )
}

export { RadioGroup, RadioGroupOption, RadioGroupSegment }
