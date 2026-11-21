import type { ReactNode } from "react";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyPanel, ShimmerRows } from "./panel-shared";

export function CashPanel({ regionId, currency, isVerified, isChecking, content }: {
  regionId: RegionId; currency?: FiatCurrencyCode | null;
  isVerified: boolean;
  isChecking: boolean;
  content?: ReactNode;
}) {
  return (
    <PresentationRegionProvider regionId={regionId} currency={currency}>
      <div id="cash-panel" aria-busy={isChecking}>
        {isVerified ? content ?? <EmptyPanel label="Cash" /> : isChecking ? <CashPanelShell /> : <EmptyPanel label="Cash" />}
      </div>
    </PresentationRegionProvider>
  );
}

export function InvestPanel({
  regionId,
  currency,
  content,
}: {
  regionId: RegionId; currency?: FiatCurrencyCode | null;
  content?: ReactNode;
}) {
  return (
    <PresentationRegionProvider regionId={regionId} currency={currency}>
      {content ?? <EmptyPanel label="Investments" />}
    </PresentationRegionProvider>
  );
}

export function InvestmentsPanel({ regionId, currency, content }: { regionId: RegionId; currency?: FiatCurrencyCode | null; content?: ReactNode }) {
  return (
    <PresentationRegionProvider regionId={regionId} currency={currency}>
      {content ?? <EmptyPanel label="Investments" />}
    </PresentationRegionProvider>
  );
}

function CashPanelShell() {
  return (
    <section className="space-y-4" aria-busy="true">
      <Card variant="flush">
        <CardContent inset="hero">
          <ShimmerRows variant="hero" />
          <span className="sr-only">Updating…</span>
        </CardContent>
      </Card>
      <ShimmerRows count={2} />
    </section>
  );
}
