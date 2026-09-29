"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { LoadErrorCard } from "@/components/load-error";

export function FeeSettingsUnavailable() {
  const router = useRouter();
  return (
    <div className="w-full max-w-2xl">
      <LoadErrorCard
        tone="destructive"
        title="Fee settings couldn’t load"
        description="Saving is off until they load."
        onRetry={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
