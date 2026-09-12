"use client";

import { Button, Text } from "@home/ui";
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
      <div className={styles.fieldHeader}>
        <label htmlFor="account-otp">Verification code</label>
        <Button
          className={styles.changeEmailButton}
          variant="quiet"
          onClick={onChangeEmail}
          disabled={isVerifyingCode || isSendingCode}
        >
          Change email
        </Button>
      </div>
      <input
        ref={inputRef}
        id="account-otp"
        className={styles.otpInput}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={otp}
        onChange={(event) => onOtpChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        disabled={isVerifyingCode}
        aria-describedby="account-otp-help"
        autoFocus
        data-initial-focus
      />
      <Text id="account-otp-help" className={styles.fieldHelp} textStyle="metadata" tone="muted">
        Sent to {email}. Codes expire.
      </Text>
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
