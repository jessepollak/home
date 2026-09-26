import type { ReactNode } from "react";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { RegionId } from "@/config/regions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyPanel, ShimmerRows } from "./panel-shared";

export function CashPanel({ regionId, isVerified, isChecking, content }: {
  regionId: RegionId;
  isVerified: boolean;
  isChecking: boolean;
  content?: ReactNode;
}) {
  return (
    <PresentationRegionProvider regionId={regionId}>
      <div id="cash-panel" aria-busy={isChecking}>
        {isVerified ? content ?? <EmptyPanel label="Cash" /> : isChecking ? <CashPanelShell /> : <EmptyPanel label="Cash" />}
      </div>
    </PresentationRegionProvider>
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

function CashPanelShell() {
  return (
    <section className="space-y-4" aria-busy="true">
      <Card variant="flush">
        <CardContent inset="hero">
          <Skeleton className="h-10 w-48" data-shimmer="hero" />
          <span className="sr-only">Updating…</span>
        </CardContent>
      </Card>
      <ShimmerRows count={2} />
    </section>
  );
}
