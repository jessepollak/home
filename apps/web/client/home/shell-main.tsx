"use client";

import { type ReactNode, type RefObject } from "react";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } from "@/components/ui/pull-to-refresh";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { shellFrameClassName, shellNavigationClearanceClassName } from "@/components/shell-layout";
import { useHomeRefresh } from "./use-home-refresh";
import { ShellSearchSurfaceSlot, useShellSearch } from "./shell-search";

export function ShellMain({ children, mainRef, contentFrameRef, refreshInput, pullEnabled }: {
  children: ReactNode;
  mainRef: RefObject<HTMLElement | null>;
  contentFrameRef: RefObject<HTMLDivElement | null>;
  refreshInput: Parameters<typeof useHomeRefresh>[0];
  pullEnabled: boolean;
}) {
  const { open } = useShellSearch();
  const enabled = refreshInput.enabled && !open;
  const { state, refresh } = useHomeRefresh({ ...refreshInput, enabled });
  const { phase, indicatorRef, actionRef } = usePullToRefresh({
    scrollRef: mainRef, scrollElement: "document", contentRef: contentFrameRef,
    enabled: enabled && pullEnabled,
    refreshing: state.phase === "refreshing", onRefresh: () => { void refresh(); },
  });
  return <main ref={mainRef} data-rail-follower="" data-app-main-authenticated className={`relative min-w-0 flex-1 bg-muted ${open ? "flex min-h-0 flex-col overflow-hidden" : shellNavigationClearanceClassName}`}>
    {enabled ? <PullToRefreshAction label="Refresh Home" refreshing={state.phase === "refreshing"}
      onRefresh={() => { void refresh(); }} actionRef={actionRef} /> : null}
    {enabled ? <PullToRefreshIndicator phase={phase} indicatorRef={indicatorRef} /> : null}
    <div ref={contentFrameRef} hidden={open} inert={open} aria-hidden={open ? true : undefined} className={`${shellFrameClassName} py-4 sm:py-6`}>
      <span role="status" aria-live="polite" className="sr-only">{enabled
        ? state.phase === "refreshing" ? "Refreshing Home" : state.phase === "complete" ? "Home updated" : null : null}</span>
      {enabled && (state.phase === "failed" || state.phase === "partial") ? <Alert className="mb-4" role="alert">
        <AlertDescription>{state.phase === "failed" ? "Couldn't refresh Home." : "Some of Home didn't refresh."}</AlertDescription>
        <AlertAction><Button variant="outline" size="touch" onClick={() => { void refresh(); }}>Retry</Button></AlertAction>
      </Alert> : null}
      {children}
    </div>
    <ShellSearchSurfaceSlot />
  </main>;
}
