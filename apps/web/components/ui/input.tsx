import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const inputVariants = cva(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "not-disabled:not-focus-visible:not-aria-invalid:hover:border-input-hover",
        code: "font-mono not-disabled:not-focus-visible:not-aria-invalid:hover:border-input-hover",
        touch: "md:text-base not-disabled:not-focus-visible:not-aria-invalid:hover:border-input-hover",
        "shell-search": "relative h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-[max(16px,1.0625rem)] shadow-none transition-none focus-visible:border-0 focus-visible:ring-0 md:text-[max(16px,1.0625rem)] lg:text-base dark:bg-transparent",
        amount: "h-auto rounded-none border-0 bg-transparent px-0 py-0 text-[length:inherit] font-[inherit] leading-[inherit] text-foreground caret-primary shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 aria-invalid:border-0 aria-invalid:ring-0 md:text-[length:inherit] dark:bg-transparent dark:aria-invalid:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Input }
