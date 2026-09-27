"use client";

import { useEffect } from "react";
import { LoadErrorCard } from "@/components/load-error";
import { reportClientError } from "@/client/observability/client-reporter";

const reportedErrors = new WeakSet<Error>();

export function AppErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LoadErrorCard title="This page couldn’t load." tone="destructive" onRetry={onRetry} />
      </div>
    </main>
  );
}

export function AppErrorFallback({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
    void reportClientError({
      name: error.name,
      message: error.message,
      route: window.location.pathname,
    });
  }, [error]);

  return <AppErrorState onRetry={retry} />;
}
