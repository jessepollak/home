"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RefObject } from "react";
import type { BaseAccountLoginPhase } from "./cdp-client";

const baseAccountSignInLabel = "Sign in with Base Account";

export function baseAccountPhaseMessage(phase: BaseAccountLoginPhase): string {
  switch (phase) {
    case "connecting": return "Connecting to your existing Base Account…";
    case "signing": return "Confirm sign-in in Base Account…";
    case "verifying": return "Finishing sign-in…";
  }
}

export function BaseAccountButtonContent({ phase }: { phase: BaseAccountLoginPhase | null }) {
  if (!phase) return baseAccountSignInLabel;
  return (
    <>
      <span className="sr-only">{baseAccountSignInLabel}</span>
      <LoaderCircle
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
        data-icon="inline-start"
      />
      <span aria-hidden="true">{baseAccountPhaseMessage(phase)}</span>
    </>
  );
}

export function BaseAccountLiveStatus({ phase }: { phase: BaseAccountLoginPhase | null }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {phase ? baseAccountPhaseMessage(phase) : null}
    </div>
  );
}

export function BaseAccountOnlySignIn({
  buttonRef,
  phase,
  onSignIn,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  phase: BaseAccountLoginPhase | null;
  onSignIn: () => void;
}) {
  return (
    <div className="mt-4">
      <Button
        ref={buttonRef}
        className={phase ? "h-11 w-full whitespace-normal" : "h-11 w-full"}
        size="lg"
        variant="secondary"
        onClick={onSignIn}
        aria-busy={phase ? true : undefined}
        aria-disabled={phase ? true : undefined}
        autoFocus
        data-initial-focus
      >
        <BaseAccountButtonContent phase={phase} />
      </Button>
      <BaseAccountLiveStatus phase={phase} />
    </div>
  );
}
