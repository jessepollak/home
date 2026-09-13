"use client";

import { Button } from "@/components/ui/button";
import type { RefObject } from "react";
import type { BaseAccountLoginPhase } from "./cdp-client";
import styles from "./account.module.css";

export function baseAccountPhaseMessage(phase: BaseAccountLoginPhase): string {
  switch (phase) {
    case "connecting": return "Connecting to your existing Base Account…";
    case "signing": return "Confirm sign-in in Base Account…";
    case "verifying": return "Finishing sign-in…";
  }
}

export function BaseAccountOnlySignIn({
  buttonRef,
  onSignIn,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onSignIn: () => void;
}) {
  return (
    <div className={styles.form}>
      <Button
        ref={buttonRef}
        className={styles.formAction}
        variant="secondary"
        onClick={onSignIn}
        autoFocus
        data-initial-focus
      >
        Sign in with Base Account
      </Button>
    </div>
  );
}

export function BaseAccountHandoff({
  phase,
  onCancel,
}: {
  phase: BaseAccountLoginPhase | null;
  onCancel: () => void;
}) {
  return (
    <aside className={styles.providerHandoff} aria-live="polite" role="status">
      {phase ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <p className="text-caption text-muted-foreground">
            {baseAccountPhaseMessage(phase)}
          </p>
        </>
      ) : null}
      <Button className={styles.providerAction} variant="secondary" onClick={onCancel}>
        Cancel sign in
      </Button>
    </aside>
  );
}
