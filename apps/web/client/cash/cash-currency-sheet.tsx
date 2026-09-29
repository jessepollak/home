"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { MoneyModal, MoneyModalActions, MoneyModalBody, MoneyModalHeader, MoneyModalStep, MoneyModalStepLoading, deferStep } from "@/client/money-modal";
import { browserHomeQueryClient } from "@/client/query/query-client";
import { tradeAvailabilityOptions } from "@/client/trading/use-trade-availability";
import { CurrencyMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatUsdStablecoinAmount } from "@/shared/formatting";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { cashConversionCurrency, cashConversionDestinations, cashConversionTrade, type CashConversionCurrency, type CashConversionCurrencyCode } from "@/shared/trading/cash-conversion";
import type { TradeDirection, TradeToken } from "@/shared/trading/contract";
import { cashHoldings } from "./cash-overview";

const TradeStep = deferStep(() => import("@/client/trading/trade-money-dialog").then((module) => module.TradeMoneyFlow));
const SavingsStep = deferStep(() => import("@/client/savings/savings-actions").then((module) => module.SavingsMoneyFlow));


function deferredStepLoading({ title, titleId, closeLabel, depth, onBack }: { title: string; titleId: string; closeLabel: string; depth: number; onBack: () => void }) {
  return ({ failed, retry }: { failed: boolean; retry: () => void }) => <MoneyModalStepLoading step="amount" depth={depth} title={title} titleId={titleId}
    onBack={onBack} closeLabel={closeLabel} failed={failed} onRetry={retry} />;
}
type Entry = { kind: "convert" | "currency"; source: CashConversionCurrencyCode };
type TradeSelection = { currency: CashConversionCurrency; token: TradeToken; direction: TradeDirection; balanceBaseUnits: string | null };
type Props = {
  open: boolean;
  entry: Entry;
  session: VerifiedAccountSession;
  snapshot: BalancesSnapshot;
  best: MorphoVaultCandidate | null;
  balanceStale: boolean;
  depositEntryBlocked?: boolean;
  historyBlocked: boolean;
  onSaveEntry: () => void;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onCancel: () => void;
  onClosed: (unresolved: boolean) => void;
  onAddMoney: () => void;
  onConfirmed: () => void | Promise<void>;
};

type Step = "currency" | "destination" | "trade" | "save";

export function CashCurrencySheet({ open, entry, session, snapshot, best, balanceStale, depositEntryBlocked = false, historyBlocked, onSaveEntry, fetchAccountResource, prepareMoneyAction, executeMoneyAction, onCancel, onClosed, onAddMoney, onConfirmed }: Props) {
  const [step, setStep] = useState<Step>(entry.kind === "currency" ? "currency" : "destination");
  const [selected, setSelected] = useState<CashConversionCurrency | null>(null);
  const [trade, setTrade] = useState<TradeSelection | null>(null);
  const [saveCandidate, setSaveCandidate] = useState<MorphoVaultCandidate | null>(null);
  const [draft, setDraft] = useState("");
  const [resume, setResume] = useState<{ amount: string; amountBaseUnits: string; prepared: PreparedMoneyAction } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const unresolved = useRef(false);
  const addMoneyAfterClose = useRef(false);
  const source = cashConversionCurrency(entry.source);
  const destinations = useMemo(() => cashConversionDestinations(source.code), [source.code]);
  const queries = useQueries({ queries: destinations.map((currency) => ({
    ...tradeAvailabilityOptions(session, currency.code === "USD" ? source.tradeAssetId : currency.tradeAssetId, fetchAccountResource),
    enabled: open && Boolean(session.smartAccount),
  })) }, browserHomeQueryClient());
  const sourceHolding = snapshot.holdings.find((holding) => holding.id === source.portfolioAssetId);
  const sourceBalance = sourceHolding?.balance.status === "ready" ? sourceHolding.balance.baseUnits : null;
  const usdcBalance = snapshot.holdings.find((holding) => holding.id === "usdc")?.balance;
  const usdcBaseUnits = !balanceStale && usdcBalance?.status === "ready" ? usdcBalance.baseUnits : null;
  const canSave = source.code === "USD" && best !== null && usdcBaseUnits !== null && !depositEntryBlocked;
  const row = cashHoldings(snapshot).find((item) => item.currency === source.code && item.holding);
  const depth = entry.kind === "currency" ? 1 : 0;

  const readyTrade = useCallback((currency: CashConversionCurrency): TradeSelection | null => {
    const index = destinations.findIndex((candidate) => candidate.code === currency.code);
    const query = index >= 0 ? queries[index] : undefined;
    const availability = query?.data;
    const route = cashConversionTrade(source.code, currency.code);
    if (!route || query?.isError || availability?.status !== "available") return null;
    if (availability.token.assetId !== route.assetId) return null;
    if (availability.token.address.toLowerCase() !== (route.direction === "buy" ? currency.address : source.address).toLowerCase()) return null;
    if (availability.token.decimals !== (route.direction === "buy" ? currency.decimals : source.decimals)) return null;
    if (route.direction === "buy" && availability.buy !== "available") return null;
    return { currency, token: availability.token, direction: route.direction, balanceBaseUnits: availability.balanceBaseUnits };
  }, [destinations, queries, source]);
  const selectedIndex = selected ? destinations.findIndex((currency) => currency.code === selected.code) : -1;
  const selectedQuery = selectedIndex >= 0 ? queries[selectedIndex] : undefined;
  const readySelection = step === "trade" && selected ? readyTrade(selected) : null;
  if (readySelection && !trade) setTrade(readySelection);
  function pick(currency: CashConversionCurrency) {
    if (selected?.code !== currency.code) { setDraft(""); setResume(null); }
    setSelected(currency);
    setTrade(readyTrade(currency));
    setStep("trade");
    void TradeStep.preload();
  }
  function convert() {
    const only = destinations.at(0);
    if (only && destinations.length === 1 && sourceBalance !== null && sourceBalance !== "0") pick(only);
    else setStep("destination");
  }
  function backFromTrade() {
    setStep(destinations.length === 1 && entry.kind === "currency" ? "currency" : "destination");
  }
  const titleId = "cash-conversion-title";
  return <MoneyModal open={open} labelledBy={step === "trade" ? "trade-action-title" : step === "save" ? "savings-action-title" : titleId}
    onCancel={onCancel} onClose={() => {
      if (unresolved.current && resume && Date.parse(resume.prepared.expiresAt) <= Date.now()) unresolved.current = false;
      if (!unresolved.current) {
        setStep(entry.kind === "currency" ? "currency" : "destination");
        setSelected(null);
        setTrade(null);
        setSaveCandidate(null);
        setDraft("");
        setResume(null);
        setResetKey((key) => key + 1);
      }
      onClosed(unresolved.current);
      if (addMoneyAfterClose.current) {
        addMoneyAfterClose.current = false;
        onAddMoney();
      }
    }}>
    {step === "currency" ? <MoneyModalStep step="currency" depth={0}>
      <MoneyModalHeader title={source.name} titleId={titleId} closeLabel="Close currency details" />
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <CurrencyMark currency={source.code} symbol={source.symbol} />
          <p className="text-4xl font-semibold tabular-nums"><MoneyTicker animated={false} align="start" reserveDigits={false} value={row?.value ?? "Unavailable"} /></p>
          <p className="text-sm text-muted-foreground">{source.symbol}{row?.usdValue ? ` · ≈ ${row.usdValue}` : row?.usdUnavailable ? " · USD value unavailable" : ""}</p>
          {balanceStale ? <p className="text-sm text-muted-foreground">Balance may be out of date.</p> : null}
        </div>
      </MoneyModalBody>
      <MoneyModalActions><div className={canSave ? "grid grid-cols-2 gap-2" : ""}>
        <Button className="min-h-11 w-full" onPointerDown={() => void TradeStep.preload()} onClick={convert}>Convert</Button>
        {canSave ? <Button variant="secondary" className="min-h-11 w-full" onPointerDown={() => void SavingsStep.preload()} onClick={() => { onSaveEntry(); setSaveCandidate(best); setStep("save"); void SavingsStep.preload(); }}>Save</Button> : null}
      </div></MoneyModalActions>
    </MoneyModalStep> : null}
    {step === "destination" ? <MoneyModalStep step="destination" depth={depth}>
      <MoneyModalHeader title="Convert to" titleId={titleId} closeLabel="Close conversion" onBack={entry.kind === "currency" ? () => setStep("currency") : undefined} />
      <MoneyModalBody hasFooter={sourceBalance === "0" && !balanceStale} className="gap-3 pt-4">
        {sourceBalance === "0" && !balanceStale ? <p>{source.code === "USD" ? "No US dollars to convert." : `No ${source.name} balance to convert.`}</p> : <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
          {destinations.map((currency, index) => {
            const query = queries.at(index);
            if (!query) return null;
            const state = query.data;
            const trade = cashConversionTrade(source.code, currency.code);
            const supported = state?.status === "available" && !!trade && state.token.assetId === trade.assetId && state.token.address.toLowerCase() === (trade.direction === "buy" ? currency.address : source.address).toLowerCase() && state.token.decimals === (trade.direction === "buy" ? currency.decimals : source.decimals);
            const unavailable = state?.status === "unavailable" || (state?.status === "available" && (!supported || (trade?.direction === "buy" && state.buy === "blocked")));
            return <BalanceRow key={currency.code} icon={<CurrencyMark size="sm" currency={currency.code} symbol={currency.symbol} />} iconTone="mark"
              label={currency.name} context={query.isError ? "Couldn't check availability" : unavailable ? "Conversion unavailable" : !state ? "Checking availability…" : currency.code}
              value={selected?.code === currency.code ? "Selected" : undefined}
              onActivate={sourceBalance !== null && supported && !query.isError && (trade?.direction !== "buy" || state.buy === "available") ? () => pick(currency) : undefined}
              activateLabel={`Convert to ${currency.name}`} chevron={Boolean(sourceBalance !== null && supported && !query.isError && (trade?.direction !== "buy" || state.buy === "available"))} />;
          })}
        </ul></CardContent></Card>}
        {balanceStale ? <p className="text-sm text-muted-foreground">Balance may be out of date.</p> : null}
        {queries.some((query) => query.isError) ? <Button variant="secondary" className="min-h-11" onClick={() => { for (const query of queries) if (query.isError) void query.refetch(); }}>Try again</Button> : null}
        {sourceBalance === null ? <p className="text-sm text-muted-foreground">Balance unavailable. Try again shortly.</p> : null}
      </MoneyModalBody>
      {sourceBalance === "0" && !balanceStale ? <MoneyModalActions><Button className="min-h-11 w-full" onClick={() => { addMoneyAfterClose.current = true; onCancel(); }}>Add money</Button></MoneyModalActions> : null}
    </MoneyModalStep> : null}
    {step === "trade" && selected && trade && trade.currency.code === selected.code ? <TradeStep key={`${resetKey}:${source.code}:${trade.currency.code}`} depth={depth + 1} session={session} token={trade.token}
      direction={trade.direction} assetName={selected.name} conversion={{ from: source, to: selected }}
      availableBaseUnits={trade.direction === "buy" ? usdcBaseUnits : trade.balanceBaseUnits}
      fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction}
      initialAmount={draft} onAmountChange={setDraft} onBack={backFromTrade} onDone={onCancel} resume={resume ?? undefined}
      onAttemptedChange={(attempted, unknown) => { unresolved.current = attempted && !unknown; if (!unresolved.current) setResume(null); }}
      onUnresolved={setResume}
      onConfirmed={async () => { setResume(null); await onConfirmed(); }}
      fallback={deferredStepLoading({ title: `Convert to ${selected.name}`, titleId: "trade-action-title", closeLabel: "Close conversion", depth: depth + 1, onBack: backFromTrade })} />
      : step === "trade" && selected && !trade && selectedQuery?.isPending && !selectedQuery.isError ? <MoneyModalStepLoading key={resetKey} step="amount" depth={depth + 1} title={`Convert to ${selected.name}`} titleId="trade-action-title"
        onBack={backFromTrade} closeLabel="Close conversion" failed={false} onRetry={() => { for (const query of queries) if (query.isError) void query.refetch(); }} />
      : step === "trade" ? <MoneyModalStep key={resetKey} step="trade-unavailable" depth={depth + 1}>
        <MoneyModalHeader title="Conversion unavailable" titleId="trade-action-title" onBack={backFromTrade} closeLabel="Close conversion" />
        <MoneyModalBody hasFooter={Boolean(selectedQuery?.isError)}><p>Can&apos;t convert this currency right now. Try again later.</p></MoneyModalBody>
        {selectedQuery?.isError ? <MoneyModalActions><Button variant="secondary" className="min-h-11 w-full" onClick={() => void selectedQuery.refetch()}>Try again</Button></MoneyModalActions> : null}
      </MoneyModalStep> : null}
    {step === "save" && saveCandidate ? <SavingsStep key={`${resetKey}:${saveCandidate.vaultAddress}`} depth={1} onBack={() => setStep("currency")} onDone={onCancel} mode="deposit" session={session} candidate={saveCandidate}
      availableLabel={usdcBaseUnits !== null ? `${formatUsdStablecoinAmount(usdcBaseUnits)} available` : undefined} availableBaseUnits={usdcBaseUnits} availableStale={balanceStale}
      historyBlocked={historyBlocked}
      fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction}
      fallback={deferredStepLoading({ title: "Deposit", titleId: "savings-action-title", closeLabel: "Close deposit", depth: 1, onBack: () => setStep("currency") })} /> : null}
  </MoneyModal>;
}
