"use client";

import { Button, Text } from "@home/ui";
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
        <Text as="strong" textStyle="row-label">{signInUnconfiguredCopy.heading}</Text>
        <Text textStyle="secondary" tone="muted">
          This deployment is missing <code>NEXT_PUBLIC_CDP_PROJECT_ID</code>.
        </Text>
        <Text textStyle="secondary" tone="muted">
          Copy <code>.env.example</code> to <code>apps/web/.env.local</code>, then follow{" "}
          <a href={CDP_SETUP_DOC_HREF}>{CDP_SETUP_DOC_LABEL}</a>.
        </Text>
      </div>
    );
  }
  return (
    <div className={styles.statusPanel} role="alert">
      <Text as="strong" textStyle="row-label">{signInProviderUnavailableCopy.heading}</Text>
      <Text textStyle="secondary" tone="muted">{signInProviderUnavailableCopy.body}</Text>
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
        <Text as="span" textStyle="secondary" tone="muted">{pending}</Text>
      </div>
    );
  }
  if (signOutError) {
    return (
      <div className={styles.statusPanel} role="alert">
        <Text as="strong" textStyle="row-label">Sign-out did not finish.</Text>
        <Button className={styles.statusAction} variant="secondary" onClick={onRetrySignOut}>
          Retry sign out
        </Button>
      </div>
    );
  }
  if (unavailable) {
    return (
      <div className={styles.statusPanel} role="alert">
        <Text as="strong" textStyle="row-label">We could not verify this session.</Text>
        <Button className={styles.statusAction} variant="secondary" onClick={onRetryValidation}>
          Try again
        </Button>
      </div>
    );
  }
  return null;
}
