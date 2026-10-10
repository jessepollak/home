"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { AggregateSignals, type AggregateSignal } from "@/components/ui/aggregate-signals";
import { Alert, AlertAction, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ItemDescription } from "@/components/ui/item";
import type { InvestAsset } from "@/config/invest-assets";
import type { ExactDecimal } from "@/shared/balances/types";
import { formatPresentationDate, formatPresentationPercentage } from "@/shared/formatting";
import type { TokenRiskSignals } from "@/shared/invest/contracts/market-stats";
import { usePresentationRegionId } from "./presentation-quote";
import { useTokenRisk } from "./use-market-stats";

const flagRows = [
  ["honeypot", "honeypot", "May not be sellable", "GoPlus flags a possible honeypot"],
  ["cannotSellAll", "sell limit", "Sell limit", "GoPlus reports holders can't sell their full balance at once"],
  ["transferPausable", "pause", "Transfers can be paused", "The contract owner can pause trading"],
  ["blacklist", "blocklist", "Addresses can be blocked", "The contract can block addresses from trading. This doesn't mean yours is blocked."],
  ["taxModifiable", "tax changes", "Taxes can change", "The contract owner can change buy or sell tax"],
  ["personalTaxModifiable", "per-address tax", "Per-address tax", "The owner can set a different tax for specific addresses"],
] as const;
const taxRows = [
  ["sellTax", "sell tax", "Sell tax", "Taken from each sale"],
  ["buyTax", "buy tax", "Buy tax", "Taken from each purchase"],
  ["transferTax", "transfer tax", "Transfer tax", "Taken from each transfer"],
] as const;
const signalLabels: Array<[keyof TokenRiskSignals, string]> = [
  ["honeypot", "honeypot"], ["cannotSellAll", "sell limit"], ["buyTax", "buy tax"],
  ["sellTax", "sell tax"], ["transferTax", "transfer tax"], ["transferPausable", "pause"],
  ["blacklist", "blocklist"], ["taxModifiable", "tax changes"], ["personalTaxModifiable", "per-address tax"],
];

function taxPercentage(fraction: ExactDecimal, regionId: ReturnType<typeof usePresentationRegionId>) {
  const tiny = BigInt(fraction.atoms) * BigInt(10000) < BigInt(10) ** BigInt(fraction.scale);
  return tiny ? `<${formatPresentationPercentage(0.0001, regionId)}`
    : formatPresentationPercentage(Number(`${fraction.atoms}e-${fraction.scale}`), regionId)
      .replace(/([.,])(\d*?)0+(?=\D|$)/, (_match, separator: string, digits: string) => digits ? `${separator}${digits}` : "");
}

function sellTaxBlocks(signals: TokenRiskSignals) {
  return signals.sellTax.state === "reported"
    && BigInt(signals.sellTax.fraction.atoms) === BigInt(10) ** BigInt(signals.sellTax.fraction.scale);
}

function signalSummary(signals: TokenRiskSignals): AggregateSignal[] {
  const summary: AggregateSignal[] = [];
  if (signals.honeypot === "reported" || signals.cannotSellAll === "reported" || sellTaxBlocks(signals)) {
    summary.push({ id: "sell", label: "Sell restriction reported", tone: "danger" });
  }
  if (taxRows.some(([key]) => signals[key].state === "reported" && !(key === "sellTax" && sellTaxBlocks(signals)))) {
    summary.push({ id: "taxes", label: "Transfer taxes reported", tone: "caution" });
  }
  if (flagRows.slice(2).some(([key]) => signals[key] === "reported")) {
    summary.push({ id: "controls", label: "Transfer controls reported", tone: "caution" });
  }
  const states = signalLabels.map(([key]) => typeof signals[key] === "string" ? signals[key] : signals[key].state);
  if (!summary.length) summary.push({ id: "flags", label: states.some((state) => state === "absent")
    ? "No supported flags reported" : "No check data", tone: states.some((state) => state === "absent") ? "positive" : "neutral" });
  if (states.includes("unknown") && states.some((state) => state !== "unknown")) {
    summary.push({ id: "unknown", label: "Some signals unknown", tone: "neutral" });
  }
  return summary;
}

function signalRows(signals: TokenRiskSignals, regionId: ReturnType<typeof usePresentationRegionId>): AggregateSignal[] {
  const absentLabels = {
    honeypot: "No honeypot flag reported", cannotSellAll: "No sell limit reported",
    transferPausable: "No pause capability reported", blacklist: "No blocklist capability reported",
    taxModifiable: "No tax changes reported", personalTaxModifiable: "No per-address tax reported",
  };
  const flags = flagRows.flatMap(([key, , label, detail]): AggregateSignal[] => signals[key] === "unknown" ? []
    : [{ id: key, label: signals[key] === "reported" ? label : absentLabels[key],
      ...(signals[key] === "reported" ? { detail } : {}),
      tone: signals[key] === "absent" ? "positive" : key === "honeypot" || key === "cannotSellAll" ? "danger" : "caution" }]);
  const taxes = taxRows.flatMap(([key, , label, detail]): AggregateSignal[] => {
    const tax = signals[key];
    if (tax.state === "unknown") return [];
    if (tax.state === "absent") return [{ id: key, label: `No ${label.toLowerCase()} reported`, tone: "positive" }];
    const blocked = key === "sellTax" && sellTaxBlocks(signals);
    return [{ id: key, label: `${label} ${taxPercentage(tax.fraction, regionId)}`,
      detail: blocked ? "GoPlus reports a 100% sell tax" : detail,
      tone: blocked ? "danger" : "caution" }];
  });
  const rows = [...flags.filter((row) => row.id === "honeypot" || row.id === "cannotSellAll"),
    ...taxes, ...flags.filter((row) => row.id !== "honeypot" && row.id !== "cannotSellAll")];
  const unknown = signalLabels.flatMap(([key, label]) => {
    const signal = signals[key];
    return (typeof signal === "string" ? signal : signal.state) === "unknown" ? [label] : [];
  });
  rows.sort((a, b) => Number(a.tone === "positive") - Number(b.tone === "positive"));
  if (unknown.length) rows.push({ id: "unknown", label: "Unknown signals", detail: `No data: ${unknown.join(", ")}`, tone: "neutral" });
  return rows;
}

export function AssetRisk({ asset, headingLevel = 3 }: { asset: InvestAsset; headingLevel?: 2 | 3 }) {
  const risk = useTokenRisk(asset);
  const [retrying, setRetrying] = useState(false);
  const busy = risk.refreshing || retrying;
  const retry = async () => {
    if (busy) return;
    setRetrying(true);
    try { await risk.retry(); } finally { setRetrying(false); }
  };
  const regionId = usePresentationRegionId();
  const checked = risk.status === "ready" || risk.status === "stale"
    ? formatPresentationDate(risk.checkedAt, { regionId, style: "date-time-zone" }) : null;
  const message = risk.status === "stale" ? "Couldn't refresh"
    : risk.status === "unsupported" ? "GoPlus has no data for this token"
      : risk.status === "throttled" ? "Token check is busy" : "Couldn't check this token";
  const summary: AggregateSignal[] = risk.status === "ready" || risk.status === "stale"
    ? signalSummary(risk.signals) : [{ id: "status", label: risk.status === "loading" ? "Checking token" : message, tone: "neutral" }];
  if (risk.status === "stale") summary.unshift({ id: "stale", label: "Stale · Couldn't refresh", tone: "neutral" });
  return <section aria-label="Token checks" aria-busy={risk.status === "loading" || busy || undefined}>
    <AggregateSignals key={`${asset.chainId}:${asset.contractAddress.toLowerCase()}`} title="Token checks"
      source="GoPlus" summary={summary} headingLevel={headingLevel}
      metadata={checked ? `Reported by GoPlus · checked ${checked}` : undefined}
      signals={risk.status === "ready" || risk.status === "stale" ? signalRows(risk.signals, regionId) : []}>
      {risk.status === "loading" ? <ItemDescription tone="foreground">Checking token</ItemDescription> : <>
        {risk.status !== "ready" ? <Alert>
          <AlertIcon><CircleAlert /></AlertIcon><AlertTitle>{message}</AlertTitle>
          <AlertAction><Button variant="outline" size="sm" onClick={() => void retry()}
            aria-disabled={busy || undefined} aria-busy={busy || undefined}>Try again</Button></AlertAction>
        </Alert> : null}
      </>}
    </AggregateSignals>
  </section>;
}
