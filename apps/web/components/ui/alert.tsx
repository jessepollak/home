import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "group/alert flex w-full flex-wrap items-center gap-x-2.5 gap-y-3 rounded-lg border bg-card px-4 py-3.5 text-start text-sm leading-5 text-card-foreground",
  {
    variants: {
      variant: {
        default: "",
        destructive:
          "**:data-[slot=alert-icon]:text-destructive **:data-[slot=alert-title]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const content: React.ReactNode[] = []
  const actions: React.ReactNode[] = []

  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === AlertAction) {
      actions.push(child)
    } else {
      content.push(child)
    }
  }

  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <div data-slot="alert-content" className="grid min-w-0 flex-1 basis-48 grid-cols-[minmax(0,1fr)] gap-x-2.5 has-data-[slot=alert-icon]:grid-cols-[1rem_minmax(0,1fr)]">
        {content}
      </div>
      {actions}
    </div>
  )
}

function AlertIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="alert-icon"
      aria-hidden="true"
      className={cn("col-start-1 row-start-1 mt-px flex h-5 w-4 shrink-0 items-center self-start [&_svg]:size-4", className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-1 row-start-1 min-w-0 font-medium group-has-data-[slot=alert-icon]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
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
      className={cn(
        "col-start-1 row-start-1 min-w-0 text-balance text-foreground group-has-data-[slot=alert-icon]/alert:col-start-2 group-has-data-[slot=alert-title]/alert:row-start-2 group-has-data-[slot=alert-title]/alert:mt-1 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("ms-auto shrink-0 text-foreground", className)}
      {...props}
    />
  )
}

export { Alert, AlertIcon, AlertTitle, AlertDescription, AlertAction }
