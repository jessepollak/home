"use client";

import * as React from "react";
import { cn } from "cn";
import { OTPInput, OTPInputContext } from "input-otp";

function InputOTP({
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      dir="ltr"
      containerClassName={cn("group/otp flex w-full min-w-0 items-center has-disabled:cursor-not-allowed has-disabled:opacity-50", containerClassName)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      dir="ltr"
      className={cn("flex w-full min-w-0 items-center gap-2", className)}
      {...props}
    />
  );
}

function InputOTPSlot({ index, className, ...props }: React.ComponentProps<"div"> & { index: number }) {
  const { char, hasFakeCaret, isActive } = React.useContext(OTPInputContext).slots[index];

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      aria-hidden="true"
      className={cn(
        "relative flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border border-input bg-background text-center text-xl font-medium tabular-nums",
        "data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50",
        "group-has-[[aria-invalid=true]]/otp:border-destructive group-has-[[aria-invalid=true]]/otp:ring-3 group-has-[[aria-invalid=true]]/otp:ring-destructive/20",
        "dark:group-has-[[aria-invalid=true]]/otp:ring-destructive/40",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-px bg-foreground motion-safe:animate-otp-caret" />
        </span>
      )}
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
