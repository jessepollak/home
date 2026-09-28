"use client";

import { useEffect, useRef } from "react";
import { LoadErrorCard } from "@/components/load-error";
import { reportCaughtClientError } from "@/client/observability/client-reporter";

export function AppErrorState({ onRetry, focusKey }: { onRetry: () => void; focusKey?: unknown }) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryRef.current?.focus();
  }, [focusKey]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LoadErrorCard
          title="This page couldn’t load."
          tone="destructive"
          onRetry={onRetry}
          retryRef={retryRef}
        />
      </div>
    </main>
  );
}

export function AppErrorFallback({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    reportCaughtClientError(error);
  }, [error]);

  return <AppErrorState onRetry={retry} focusKey={error} />;
}
