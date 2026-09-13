"use client";

import { Button } from "@/components/ui/button";
import type { BaseAccountLoginPhase } from "./cdp-client";
import {
  CDP_SETUP_DOC_HREF,
  CDP_SETUP_DOC_LABEL,
  signInProviderUnavailableCopy,
  signInUnconfiguredCopy,
} from "./sign-in-copy";
import { baseAccountPhaseMessage } from "./sign-in-base-account";
import styles from "./account.module.css";

export function SignInBlockedPanel({
  reason,
}: {
  reason: "unconfigured" | "provider-unavailable";
}) {
  if (reason === "unconfigured") {
    return (
      <div className={styles.statusPanel} role="alert">
        <strong className="text-row-label">{signInUnconfiguredCopy.heading}</strong>
        <p className="text-caption text-muted-foreground">
          This deployment is missing <code>NEXT_PUBLIC_CDP_PROJECT_ID</code>.
        </p>
        <p className="text-caption text-muted-foreground">
          Copy <code>.env.example</code> to <code>apps/web/.env.local</code>, then follow{" "}
          <a href={CDP_SETUP_DOC_HREF}>{CDP_SETUP_DOC_LABEL}</a>.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.statusPanel} role="alert">
      <strong className="text-row-label">{signInProviderUnavailableCopy.heading}</strong>
      <p className="text-caption text-muted-foreground">{signInProviderUnavailableCopy.body}</p>
    </div>
  );
}

export function SignInStatus({
  phase,
  cleaningUp,
  checking,
  signOutError,
  unavailable,
  onRetrySignOut,
  onRetryValidation,
}: {
  phase: BaseAccountLoginPhase | null;
  cleaningUp: boolean;
  checking: boolean;
  signOutError: boolean;
  unavailable: boolean;
  onRetrySignOut: () => void;
  onRetryValidation: () => void;
}) {
  const pending = phase
    ? baseAccountPhaseMessage(phase)
    : cleaningUp
      ? "Finishing sign-out…"
      : checking
        ? "Verifying your session…"
        : null;
  if (pending) {
    return (
      <div className={styles.pendingPanel} aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <span className="text-caption text-muted-foreground">{pending}</span>
      </div>
    );
  }
  if (signOutError) {
    return (
      <div className={styles.statusPanel} role="alert">
        <strong className="text-row-label">Sign-out did not finish.</strong>
        <Button className={styles.statusAction} variant="secondary" onClick={onRetrySignOut}>
          Retry sign out
        </Button>
      </div>
    );
  }
  if (unavailable) {
    return (
      <div className={styles.statusPanel} role="alert">
        <strong className="text-row-label">We could not verify this session.</strong>
        <Button className={styles.statusAction} variant="secondary" onClick={onRetryValidation}>
          Try again
        </Button>
      </div>
    );
  }
  return null;
}
