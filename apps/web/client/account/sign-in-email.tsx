"use client";

import { Button, Field, Input, Text } from "@home/ui";
import type { FormEvent, RefObject } from "react";
import styles from "./account.module.css";

export function SignInEmail({
  email,
  isSendingCode,
  baseAccountEnabled,
  inputRef,
  onEmailChange,
  onSubmit,
  onBaseAccountSignIn,
}: {
  email: string;
  isSendingCode: boolean;
  baseAccountEnabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onEmailChange: (email: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBaseAccountSignIn: () => void;
}) {
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <Field
        className={styles.authField}
        label="Email address"
        htmlFor="account-email"
        required
      >
        <Input
          ref={inputRef}
          id="account-email"
          className={styles.input}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => onEmailChange(event.currentTarget.value)}
          disabled={isSendingCode}
          autoFocus
          data-initial-focus
        />
      </Field>
      <Button className={styles.formAction} type="submit" disabled={isSendingCode}>
        {isSendingCode ? "Sending code…" : "Continue with email"}
      </Button>
      {baseAccountEnabled ? (
        <>
          <div className={styles.signInDivider} role="separator">
            <Text as="span" textStyle="metadata" tone="muted">or</Text>
          </div>
          <Button
            className={styles.formAction}
            variant="secondary"
            onClick={onBaseAccountSignIn}
          >
            Sign in with Base Account
          </Button>
        </>
      ) : null}
    </form>
  );
}
