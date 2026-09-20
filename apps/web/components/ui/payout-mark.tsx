import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Payout brand marks own their circular geometry and brand colors so product
// code composes a variant instead of a detached class map. Brand values come
// from the payout custom properties in app/globals.css.
const payoutMarkVariants = cva(
  "flex size-7 items-center justify-center rounded-full border-2 border-background text-xs",
  {
    variants: {
      variant: {
        cashapp: "bg-payout-cashapp font-bold text-payout-cashapp-foreground",
        zelle: "bg-payout-zelle font-bold text-payout-zelle-foreground",
        monzo: "bg-payout-monzo font-bold text-payout-monzo-foreground",
        revolut: "bg-payout-revolut font-bold text-payout-revolut-foreground",
        fallback: "bg-muted font-bold text-foreground",
        count: "bg-muted font-medium text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "fallback",
    },
  }
)

function PayoutMark({
  className,
  variant = "fallback",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof payoutMarkVariants>) {
  return (
    <span
      data-slot="payout-mark"
      aria-hidden="true"
      className={cn(payoutMarkVariants({ variant }), className)}
      {...props}
    />
  )
}

type PayoutMarkVariant = NonNullable<VariantProps<typeof payoutMarkVariants>["variant"]>

export { PayoutMark, payoutMarkVariants, type PayoutMarkVariant }
