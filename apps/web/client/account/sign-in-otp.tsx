"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import type { FormEvent, RefObject } from "react";

export function SignInOtp({
  email,
  otp,
  isSendingCode,
  isVerifyingCode,
  invalid,
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
  invalid: boolean;
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
        <InputOTP
          ref={inputRef}
          id="account-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={REGEXP_ONLY_DIGITS}
          maxLength={6}
          value={otp}
          onChange={onOtpChange}
          pasteTransformer={(pasted) => pasted.replace(/\D/g, "").slice(0, 6)}
          disabled={isVerifyingCode}
          aria-invalid={invalid || undefined}
          aria-describedby="account-otp-hint"
          required
          autoFocus
          data-initial-focus
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}
          </InputOTPGroup>
        </InputOTP>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <FieldDescription id="account-otp-hint" className="min-w-0 flex-1">
            Sent to {email}. Codes expire.
          </FieldDescription>
          <Button
            className="shrink-0"
            size="touch"
            variant="ghost"
            onClick={onChangeEmail}
            disabled={isVerifyingCode || isSendingCode}
          >
            Change email
          </Button>
        </div>
      </Field>
      <Button
        className="w-full"
        size="touch"
        type="submit"
        disabled={isVerifyingCode || otp.length !== 6}
      >
        {isVerifyingCode ? "Verifying…" : "Verify and continue"}
      </Button>
      <Button
        className="w-full"
        size="touch"
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
