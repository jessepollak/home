import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { RegionId } from "@/config/regions";
import { EmptyPanel, ShimmerRows } from "./panel-shared";

export function SavingsPanel({
  regionId,
  isVerified,
  isChecking,
  content,
}: {
  regionId: RegionId;
  isVerified: boolean;
  isChecking: boolean;
  content?: ReactNode;
}) {
  if (isVerified) return (
    <PresentationRegionProvider regionId={regionId}>
      <div id="save-panel">{content ?? <EmptyPanel label="Savings" />}</div>
    </PresentationRegionProvider>
  );
  return (
    <div id="save-panel">
      {isChecking ? <SavePanelShell /> : <EmptyPanel label="Savings" />}
    </div>
  );
}

export function InvestPanel({
  regionId,
  content,
}: {
  regionId: RegionId;
  content?: ReactNode;
}) {
  return (
    <PresentationRegionProvider regionId={regionId}>
      {content ?? <EmptyPanel label="Investments" />}
    </PresentationRegionProvider>
  );
}

function SavePanelShell() {
  return (
    <section className="space-y-6" aria-busy="true">
      <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <Skeleton className="h-10 w-48" data-shimmer="hero" />
        <span className="sr-only">Updating…</span>
      </div>
      <ShimmerRows count={2} />
    </section>
  );
}
