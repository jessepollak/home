import type { ReactNode } from "react";
import { Skeleton } from "@home/ui";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { RegionId } from "@/config/regions";
import { EmptyPanel, ShimmerRows } from "./panel-shared";

export function SavingsPanel({
  isVerified,
  isChecking,
  content,
}: {
  isVerified: boolean;
  isChecking: boolean;
  content?: ReactNode;
}) {
  if (isVerified) return <div id="save-panel">{content ?? <EmptyPanel label="Savings" />}</div>;
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
    <section className="save-panel-shell" aria-busy="true">
      <div className="save-panel-shell-hero">
        <Skeleton
          shape="text"
          className="balance-hero-shimmer"
          data-shimmer="hero"
        />
        <span className="sr-status">Updating…</span>
      </div>
      <ShimmerRows count={2} />
    </section>
  );
}
