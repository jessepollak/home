"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { SupportSummaryStatus } from "@/components/profile-mark";
import type { SupportContextRef } from "@/shared/support/contract";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { useSupportSummary, type SupportFetch, type SupportStreamFetch } from "./use-support";
import { supportSheetLoading } from "./support-sheet-loading";

const SupportChatSheet = deferSheet(() => import("./support-chat").then((module) => module.SupportChat), supportSheetLoading);

type SupportActions = {
  openSupport: (context?: SupportContextRef) => void;
  unreadCount: number | null;
  summaryFailed: boolean;
  summaryStatus: SupportSummaryStatus;
  retrySummary: () => void;
};

const SupportContext = createContext<SupportActions | null>(null);

export function useOptionalSupport() {
  return useContext(SupportContext);
}

export function SupportProvider({ ownerKey, fetchAccountResource, fetchAccountResponse, children }: {
  ownerKey: string | null;
  fetchAccountResource: SupportFetch;
  fetchAccountResponse: SupportStreamFetch;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<{ ownerKey: string; context?: SupportContextRef } | null>(null);
  const [selectionOwner, setSelectionOwner] = useState(ownerKey);
  if (selectionOwner !== ownerKey) {
    setSelectionOwner(ownerKey);
    setSelection(null);
  }
  const summary = useSupportSummary(ownerKey, fetchAccountResource);
  const open = Boolean(ownerKey && selection?.ownerKey === ownerKey);
  const summaryFailed = summary.isError;
  const unreadCount = summary.data && (!summaryFailed || summary.data.unreadCount > 0) ? summary.data.unreadCount : null;
  const { refetch } = summary;
  const value = useMemo<SupportActions | null>(() => ownerKey ? {
    openSupport: (context) => setSelection({ ownerKey, ...(context ? { context } : {}) }),
    unreadCount,
    summaryFailed,
    summaryStatus: summaryFailed ? "unavailable" : unreadCount === null ? "checking" : "ready",
    retrySummary: () => { void refetch(); },
  } : null, [ownerKey, refetch, summaryFailed, unreadCount]);
  return (
    <SupportContext.Provider value={value}>
      {children}
      {ownerKey ? <SupportChatSheet
        key={ownerKey}
        open={open}
        context={open ? selection?.context : undefined}
        ownerKey={ownerKey}
        fetchAccountResource={fetchAccountResource}
        fetchAccountResponse={fetchAccountResponse}
        onClose={() => setSelection(null)}
      /> : null}
    </SupportContext.Provider>
  );
}
