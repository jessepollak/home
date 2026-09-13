"use client";

import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { RefObject } from "react";
import type { BaseAccountLoginPhase } from "./cdp-client";

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
    <div className="mt-6">
      <Button
        ref={buttonRef}
        className="h-11 w-full"
        size="lg"
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
    <Alert className="fixed right-4 bottom-4 left-4 z-20 mx-auto max-w-xl sm:right-6 sm:bottom-6 sm:left-auto" aria-live="polite" role="status">
      {phase ? (
        <>
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <AlertDescription>{baseAccountPhaseMessage(phase)}</AlertDescription>
        </>
      ) : null}
      <Button className="mt-2 w-full" size="lg" variant="secondary" onClick={onCancel}>
        Cancel sign in
      </Button>
    </Alert>
  );
}
