"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormEvent, RefObject } from "react";
import styles from "./account.module.css";

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
    <form className={styles.form} onSubmit={onSubmit}>
      <Field className={`${styles.authField} ${styles.otpField}`}>
        <FieldLabel htmlFor="account-otp" className="text-caption">
          Verification code<span className="text-destructive" aria-hidden="true">*</span>
        </FieldLabel>
        <div className={styles.authControlRow}>
          <Input
            ref={inputRef}
            id="account-otp"
            className={styles.otpInput}
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
            className={styles.changeEmailButton}
            variant="ghost"
            onClick={onChangeEmail}
            disabled={isVerifyingCode || isSendingCode}
          >
            Change email
          </Button>
        </div>
        <FieldDescription id="account-otp-hint" className="text-metadata">
          Sent to {email}. Codes expire.
        </FieldDescription>
      </Field>
      <Button
        className={styles.formAction}
        type="submit"
        disabled={isVerifyingCode || otp.length !== 6}
      >
        {isVerifyingCode ? "Verifying…" : "Verify and continue"}
      </Button>
      <Button
        className={styles.formAction}
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
