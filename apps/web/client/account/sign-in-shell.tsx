"use client";

import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { BaseAccountLoginPhase } from "./cdp-client";
import {
  CDP_SETUP_DOC_HREF,
  CDP_SETUP_DOC_LABEL,
  signInProviderUnavailableCopy,
  signInUnconfiguredCopy,
} from "./sign-in-copy";
import { baseAccountPhaseMessage } from "./sign-in-base-account";

export function SignInBlockedPanel({
  reason,
}: {
  reason: "unconfigured" | "provider-unavailable";
}) {
  if (reason === "unconfigured") {
    return (
      <Alert className="mt-6">
        <AlertTitle>{signInUnconfiguredCopy.heading}</AlertTitle>
        <AlertDescription>
          <p>
            This deployment is missing <code className="font-mono">NEXT_PUBLIC_CDP_PROJECT_ID</code>.
          </p>
          <p>
            Copy <code className="font-mono">.env.example</code> to{" "}
            <code className="font-mono">apps/web/.env.local</code>, then follow{" "}
            <a href={CDP_SETUP_DOC_HREF}>{CDP_SETUP_DOC_LABEL}</a>.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="mt-6">
      <AlertTitle>{signInProviderUnavailableCopy.heading}</AlertTitle>
      <AlertDescription>{signInProviderUnavailableCopy.body}</AlertDescription>
    </Alert>
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
      <Alert className="mt-6" aria-live="polite" role="status">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <AlertDescription>{pending}</AlertDescription>
      </Alert>
    );
  }
  if (signOutError) {
    return (
      <Alert className="mt-6">
        <AlertTitle>Sign-out did not finish.</AlertTitle>
        <AlertDescription>
          <Button className="mt-2 w-full" size="lg" variant="secondary" onClick={onRetrySignOut}>
            Retry sign out
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (unavailable) {
    return (
      <Alert className="mt-6">
        <AlertTitle>We could not verify this session.</AlertTitle>
        <AlertDescription>
          <Button className="mt-2 w-full" size="lg" variant="secondary" onClick={onRetryValidation}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
