"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CdpAccountProvider, useAccountWallet } from "@/client/account/cdp-client";
import { reportPageClientError } from "@/client/observability/client-reporter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AccountRenderSeed } from "@/shared/account/session-types";
import { parseOperatorSessionResponse } from "@/shared/operator/contract";

const RENEW_INTERVAL_MS = 5 * 60_000;
const GRANT_LAPSE_MS = 14 * 60_000;

export function OperatorEmailAccess({ granted, children, ...provider }: {
  granted: boolean;
  projectId: string | null;
  smokeFixture: boolean;
  renderSeed: AccountRenderSeed | null;
  children?: ReactNode;
}) {
  return (
    <CdpAccountProvider {...provider}>
      <OperatorEmailCheck granted={granted}>{children}</OperatorEmailCheck>
    </CdpAccountProvider>
  );
}

function OperatorEmailCheck({ granted, children }: { granted: boolean; children?: ReactNode }) {
  const { status, verification, session, fetchAccountResource } = useAccountWallet();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastGrantAt = useRef(Number.NEGATIVE_INFINITY);
  const verified = status === "verified" && verification === "server";
  const ready = verified && session?.accountProvider === "cdp-embedded";
  const leave = status === "signed-out" || (verified && session?.accountProvider !== "cdp-embedded");

  useEffect(() => {
    if (leave) router.replace("/home");
  }, [leave, router]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const requestGrant = () => {
      void fetchAccountResource("/api/admin/session", { method: "POST" }).then((value) => {
        if (!active) return;
        if (!parseOperatorSessionResponse(value)) throw new Error("Unexpected operator session response");
        const lapsed = Date.now() - lastGrantAt.current >= GRANT_LAPSE_MS;
        lastGrantAt.current = Date.now();
        if (!granted || lapsed) router.refresh();
      }).catch((error: unknown) => {
        if (!active) return null;
        const failure = error && typeof error === "object" && "status" in error ? error.status : null;
        if (failure === 401 || failure === 403) {
          router.replace("/home");
          return null;
        }
        reportPageClientError({ name: error instanceof Error ? error.name : "Error", message: "Admin access check failed", route: window.location.pathname });
        if (!granted) setFailed(true);
        return null;
      });
    };
    if (!granted || Date.now() - lastGrantAt.current > 60_000) requestGrant();
    if (!granted) return () => { active = false; };
    const renewWhenVisible = () => {
      if (!document.hidden && Date.now() - lastGrantAt.current >= RENEW_INTERVAL_MS) requestGrant();
    };
    const timer = window.setInterval(renewWhenVisible, RENEW_INTERVAL_MS);
    document.addEventListener("visibilitychange", renewWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", renewWhenVisible);
    };
  }, [attempt, fetchAccountResource, granted, ready, router]);

  if (granted) return children;
  if (failed || status === "unavailable") {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md content-center justify-items-start gap-4 px-6" role="alert">
        <p>Couldn&apos;t check Admin access.</p>
        <Button className="min-h-11 px-4" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Try again</Button>
      </main>
    );
  }
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-4 px-6" role="status" aria-label="Checking access">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
    </main>
  );
}
