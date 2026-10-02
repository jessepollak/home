"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AppDrawer } from "@/client/money-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SupportSheetLoadingState = { open: boolean; failed: boolean; retry: () => void; onCancel: () => void; onClosed: () => void; onEntered: () => void };

function SupportLoadingDrawer({ open, failed, retry, onCancel, onClosed, onEntered }: SupportSheetLoadingState) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const closedBeforeEntering = !open && !entered;
  const onClosedRef = useRef(onClosed);
  useEffect(() => { onClosedRef.current = onClosed; });
  useEffect(() => { if (closedBeforeEntering) onClosedRef.current(); }, [closedBeforeEntering]);
  return (
    <AppDrawer open={open && entered} labelledBy="support-loading-title" onCancel={onCancel} onClose={onClosed} onOpened={onEntered}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 p-4">
          <h2 id="support-loading-title" className="me-auto text-base font-semibold">Support</h2>
          <Button variant="ghost" size="touch" aria-label="Close support" onClick={onCancel}><X aria-hidden="true" /></Button>
        </div>
        <div className="flex min-h-32 flex-1 flex-col px-4 py-4">
          {failed ? (
            <div role="alert" className="grid justify-items-start gap-2 text-sm">
              Couldn&apos;t open support.
              <Button variant="outline" size="touch" onClick={retry}>Try again</Button>
            </div>
          ) : (
            <div role="status" aria-label="Loading support messages" className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="ms-auto h-10 w-2/3" /></div>
          )}
        </div>
      </div>
    </AppDrawer>
  );
}

export function supportSheetLoading({ onClose }: { onClose: () => void }) {
  return {
    onCancel: onClose,
    render: ({ open, failed, retry, onCancel, onClosed, onEntered }: SupportSheetLoadingState) => (
      <SupportLoadingDrawer open={open} failed={failed} retry={retry} onCancel={onCancel} onClosed={onClosed} onEntered={onEntered} />
    ),
  };
}
