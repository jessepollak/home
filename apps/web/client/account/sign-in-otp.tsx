"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormEvent, RefObject } from "react";

export function SignInOtp({
  email,
  otp,
  isSendingCode,
  isVerifyingCode,
  resendSeconds,
  inputRef,
  onOtpChange,
  onSubmit,
  onChangeEmail,
  onResend,
}: {
  email: string;
  otp: string;
  isSendingCode: boolean;
  isVerifyingCode: boolean;
  resendSeconds: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onOtpChange: (otp: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChangeEmail: () => void;
  onResend: () => void;
}) {
  return (
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <Field>
        <FieldLabel htmlFor="account-otp">
          Verification code<span className="text-destructive" aria-hidden="true">*</span>
        </FieldLabel>
        <div className="flex min-w-0 flex-wrap items-stretch gap-2 sm:flex-nowrap">
          <Input
            ref={inputRef}
            id="account-otp"
            className="h-11 min-w-0 flex-1"
            variant="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onInput={(event) => onOtpChange(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            disabled={isVerifyingCode}
            aria-describedby="account-otp-hint"
            required
            autoFocus
            data-initial-focus
          />
          <Button
            className="h-11 w-full sm:w-auto"
            size="lg"
            variant="ghost"
            onClick={onChangeEmail}
            disabled={isVerifyingCode || isSendingCode}
          >
            Change email
          </Button>
        </div>
        <FieldDescription id="account-otp-hint">
          Sent to {email}. Codes expire.
        </FieldDescription>
      </Field>
      <Button
        className="h-11 w-full"
        size="lg"
        type="submit"
        disabled={isVerifyingCode || otp.length !== 6}
      >
        {isVerifyingCode ? "Verifying…" : "Verify and continue"}
      </Button>
      <Button
        className="h-11 w-full"
        size="lg"
        variant="secondary"
        onClick={onResend}
        disabled={isSendingCode || resendSeconds > 0}
      >
        {isSendingCode
          ? "Sending…"
          : resendSeconds > 0
            ? `Resend code in ${resendSeconds}s`
            : "Resend code"}
      </Button>
    </form>
  );
}
