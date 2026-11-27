import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { MoneyView } from "@/client/admin/money-view";
import { OperatorRevenue } from "@/client/operator/operator-revenue";
import { readAdminMoneyPageData } from "@/server/admin-money/page-data";
import { getSqlExecutor } from "@/server/db/sql";
import { readOperatorRevenue } from "@/server/fees/revenue";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorPageDecision } from "@/server/operator/page";
import type { AdminMoneyPageData } from "@/shared/admin-money/contract";
import type { OperatorRevenueSummary } from "@/shared/fees/revenue";

function unavailable(error: unknown): null {
  writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin/money", errorName: error instanceof Error ? error.name : "UnknownError" });
  return null;
}

async function readRevenue(): Promise<OperatorRevenueSummary | null> {
  try {
    return await readOperatorRevenue(getSqlExecutor());
  } catch (error) {
    return unavailable(error);
  }
}

async function readMoney(): Promise<AdminMoneyPageData | null> {
  try {
    return await readAdminMoneyPageData();
  } catch (error) {
    return unavailable(error);
  }
}

export const instant = false;

export default async function MoneyPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  if (!address) return null;
  const [revenue, money] = await Promise.all([readRevenue(), readMoney()]);
  return (
    <OperatorSection address={address} heading="Money">
      {revenue ? <OperatorRevenue summary={revenue} /> : <OperatorEmpty>Fee revenue is unavailable. Try again later.</OperatorEmpty>}
      {money ? <MoneyView data={money} /> : <OperatorEmpty>Accounts and movements need a database.</OperatorEmpty>}
    </OperatorSection>
  );
}
