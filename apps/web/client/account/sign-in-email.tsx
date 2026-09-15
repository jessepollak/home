"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormEvent, RefObject } from "react";
import type { BaseAccountLoginPhase } from "./cdp-client";
import { BaseAccountButtonContent, BaseAccountLiveStatus } from "./sign-in-base-account";

export function SignInEmail({
  email,
  isSendingCode,
  baseAccountEnabled,
  baseAccountPhase,
  inputRef,
  onEmailChange,
  onSubmit,
  onBaseAccountSignIn,
}: {
  email: string;
  isSendingCode: boolean;
  baseAccountEnabled: boolean;
  baseAccountPhase: BaseAccountLoginPhase | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onEmailChange: (email: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBaseAccountSignIn: () => void;
}) {
  const baseAccountPending = baseAccountPhase !== null;
  return (
    <form className="mt-4" onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-email">Email address</FieldLabel>
          <Input
            ref={inputRef}
            id="account-email"
            className="h-11"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onInput={(event) => onEmailChange(event.currentTarget.value)}
            disabled={isSendingCode || baseAccountPending}
            required
            autoFocus
            data-initial-focus
          />
        </Field>
        <Button
          className="h-11 w-full"
          size="lg"
          type="submit"
          disabled={isSendingCode || baseAccountPending}
        >
          {isSendingCode ? "Sending code…" : "Continue with email"}
        </Button>
        {baseAccountEnabled ? (
          <>
            <FieldSeparator>or</FieldSeparator>
            <Button
              className={baseAccountPending ? "h-11 w-full whitespace-normal" : "h-11 w-full"}
              size="lg"
              variant="secondary"
              onClick={onBaseAccountSignIn}
              aria-busy={baseAccountPending || undefined}
              aria-disabled={baseAccountPending || undefined}
            >
              <BaseAccountButtonContent phase={baseAccountPhase} />
            </Button>
            <BaseAccountLiveStatus phase={baseAccountPhase} />
          </>
        ) : null}
      </FieldGroup>
    </form>
  );
}
