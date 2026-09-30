import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { OperatorRevenue } from "@/client/operator/operator-revenue";
import { getSqlExecutor } from "@/server/db/sql";
import { readOperatorRevenue } from "@/server/fees/revenue";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorPageDecision } from "@/server/operator/page";
import type { OperatorRevenueSummary } from "@/shared/fees/revenue";

async function readRevenue(): Promise<OperatorRevenueSummary | null> {
  try {
    return await readOperatorRevenue(getSqlExecutor());
  } catch (error) {
    writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin/money", errorName: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

export const instant = false;

export default async function MoneyPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  const revenue = await readRevenue();
  return (
    <OperatorSection address={address} heading="Money">
      {revenue ? <OperatorRevenue summary={revenue} /> : <OperatorEmpty>Fee revenue is unavailable. Try again later.</OperatorEmpty>}
    </OperatorSection>
  );
}
