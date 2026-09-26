import { Banknote, Bitcoin, ArrowLeftRight } from "lucide-react";
import { ActivityRow, AssetRow, BalanceRow } from "@/components/finance-rows";
import { Card, CardContent } from "@/components/ui/card";
import { formatFiatAmount } from "@/shared/formatting";
import { buyQuote, fixtureCash, fixtureHolding, quoteAmount } from "./trade-fixtures";
import { shellContentFrameClassName } from "@/components/shell-layout";

const displayPrice = 109589.04;
const beforeCash = formatFiatAmount(fixtureCash, "USD");
const estimate = `≈ +${quoteAmount(buyQuote, "receive")}`;
const spend = buyQuote.action.amounts.find((amount) => amount.direction === "spend");
if (!spend) throw new Error("Trade fixture has no spend amount");
const confirmedCash = Number(fixtureCash) - Number(spend.amountBaseUnits) / 10 ** spend.decimals - Number.parseFloat(buyQuote.result.networkFeePaid);
const states = [
  { name: "Pending", cash: beforeCash, holding: fixtureHolding, activity: "Pending", received: estimate, tone: "default" },
  { name: "Unknown", cash: beforeCash, holding: fixtureHolding, activity: "Checking", received: estimate, tone: "default" },
  { name: "Failed", cash: beforeCash, holding: fixtureHolding, activity: "Failed", received: quoteAmount(buyQuote, "spend"), tone: "muted" },
  { name: "Confirmed", cash: formatFiatAmount(String(confirmedCash), "USD"), holding: buyQuote.result.holding, activity: "Confirmed · Today", received: `+${buyQuote.result.confirmedReceive}`, tone: "success" },
] as const;

export function TradeConvergence() {
  return <main className="min-h-svh bg-muted/20"><div className={`${shellContentFrameClassName} space-y-6 py-6`}>
    <div><h1 className="text-xl font-semibold">After a trade</h1><p className="text-sm text-muted-foreground">Cash, Investments and Activity for each outcome (development fixtures)</p></div>
    {states.map((state) => <section key={state.name} aria-label={state.name} className="space-y-2">
      <h2 className="text-base font-semibold">{state.name}</h2>
      <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
        <BalanceRow icon={<Banknote className="size-4" />} label="Cash" value={state.cash} />
        <AssetRow icon={<Bitcoin className="size-4" />} label="Bitcoin" value={formatFiatAmount(String(Number(state.holding) * displayPrice), "USD")} valueContext={`${state.holding} cbBTC`} />
        <ActivityRow icon={<ArrowLeftRight className="size-4" />} label="Buy Bitcoin" context={state.activity} value={state.received} valueTone={state.tone} />
      </ul></CardContent></Card>
    </section>)}
  </div></main>;
}
