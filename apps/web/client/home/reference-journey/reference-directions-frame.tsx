"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HomeMark } from "@/components/home-mark";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { ProfileMark } from "@/components/profile-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { NavigationId } from "@/config/navigation";

/**
 * Shared proposal frame for the three direction examples in
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * The frame renders the real production `PrimaryNavigation`, so every direction carries
 * the same visible Home / Invest context. `save` is a Home-nested panel: passing it keeps
 * Home active in the navigation (via `isHomeNestedPanelId`) and gives the surface a Back
 * affordance, matching `HomeShell`'s nested-panel behavior. Fixture-level only: this
 * frame owns view state instead of Next routing and is not wired into `HomeShell`.
 */

export type ReferenceDirectionsSurfaceId = "home" | "save";

export function ReferenceDirectionsFrame({
  surface,
  onBack,
  onNavigate,
  children,
}: {
  surface: ReferenceDirectionsSurfaceId;
  onBack?: () => void;
  onNavigate?: (navigation: NavigationId) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="order-0 w-full shrink-0 bg-background">
        <div
          className={`${shellContentFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {surface === "home" ? (
              <HomeMark onClick={() => onNavigate?.("home")} />
            ) : (
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label="Back"
                onClick={onBack}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            )}
            {/* The surface headline keeps the page's single h1; this label is not a heading. */}
            <span className="min-w-0 truncate text-base font-semibold">
              {surface === "home" ? "Home" : "Save"}
            </span>
          </div>
          {/* Fixture account control: no address, so the Basename query stays disabled. */}
          <ProfileMark status="ready" ownerKey="reference-directions-fixture" />
        </div>
      </header>
      <main id="navigation-panel" className="order-1 min-h-0 flex-1 overflow-x-hidden bg-muted pb-4">
        <div className={`${shellContentFrameClassName} py-4`}>{children}</div>
      </main>
      <PrimaryNavigation
        activeNavigation={surface}
        onNavigate={(navigation) => onNavigate?.(navigation)}
      />
    </div>
  );
}
