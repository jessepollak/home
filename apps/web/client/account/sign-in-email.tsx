"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
      <Field className={styles.authField}>
        <FieldLabel htmlFor="account-email" className="text-caption">
          Email address<span className="text-destructive" aria-hidden="true">*</span>
        </FieldLabel>
        <Input
          ref={inputRef}
          id="account-email"
          className={styles.input}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onInput={(event) => onEmailChange(event.currentTarget.value)}
          disabled={isSendingCode}
          required
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
            <span className="text-metadata text-muted-foreground">or</span>
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
