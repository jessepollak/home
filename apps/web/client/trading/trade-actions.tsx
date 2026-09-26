"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { useAccountWallet, isServerVerified } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { selectBalanceBaseUnits } from "@/shared/balances/select";
import type { InvestAsset } from "@/config/invest-assets";
import { getTradeAssetStatus } from "@/shared/trading/assets";
import type { TradeDirection } from "@/shared/trading/contract";
import { useTradeAvailability } from "./use-trade-availability";
import { StockTradeActions } from "./stock-trade-actions";

const TradeMoneySheet = deferSheet(() => import("./trade-money-dialog").then((module) => module.TradeMoneyDialog));

export function TradeActions({ asset, layout = "row" }: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const status = getTradeAssetStatus(asset.id);
  if (!status) return null;
  if (status.status === "eligibility-required") {
    return <StockTradeActions asset={asset} layout={layout} />;
  }
  if (asset.id !== "cbbtc") return <UnavailableActions asset={asset} layout={layout} />;
  return <BitcoinTradeActions asset={asset} layout={layout} />;
}

function UnavailableActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  return <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
    <div className={layout === "sticky" ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"} aria-label={`Trade ${asset.displayName}`}>
      <Button size="touch" disabled>Buy</Button>
      <Button size="touch" variant="secondary" disabled>Sell</Button>
    </div>
    <div className="text-end text-sm text-muted-foreground" role="note">Swaps aren&apos;t available right now.</div>
  </div>;
}

function BitcoinTradeActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  const account = useAccountWallet();
  const session = isServerVerified(account) ? account.session : null;
  const region = usePresentationRegionId();
  const availability = useTradeAvailability(session, account.fetchAccountResource);
  const balances = useBalances(session?.smartAccount ? {
    subject: session.user.subject,
    smartAccountAddress: session.smartAccount.address,
    chainId: session.smartAccount.chainId,
    accountProvider: session.accountProvider,
  } : null, region, account.fetchBalances);
  const usableBalances = balances.status === "ready" && !balances.snapshot.stale && !balances.refreshError;
  const cash = usableBalances ? selectBalanceBaseUnits(balances.snapshot, "usdc") : null;
  const holding = usableBalances ? selectBalanceBaseUnits(balances.snapshot, "cbbtc") : null;
  const [direction, setDirection] = useState<TradeDirection | null>(null);
  const [mountedDirection, setMountedDirection] = useState<TradeDirection | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const ready = availability?.status === "available" && !!session?.smartAccount;
  const note = availability?.status === "unavailable"
    ? availability.reason === "signer-unsupported"
      ? "Trading isn't available for this account."
      : "Trading isn't available right now."
    : availability === null ? "Checking trading availability…" : null;
  const sellNote = ready && holding === "0" ? "No Bitcoin available to sell." : null;
  const buyNote = ready && cash === "0" ? "No Cash available to buy Bitcoin." : null;
  const balancesNote = ready && (balances.status === "error" || (balances.status === "ready" && !usableBalances)) ? "Balances aren't available right now." : null;
  function openTrade(mode: TradeDirection, button: HTMLButtonElement) {
    opener.current = button;
    setMountedDirection(mode);
    setDirection(mode);
  }
  return <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
    <div className={layout === "sticky" ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"} aria-label={`Trade ${asset.displayName}`}>
      <Button size="touch" disabled={!ready || cash === null || cash === "0"} onPointerDown={() => void TradeMoneySheet.preload()} onClick={(event) => openTrade("buy", event.currentTarget)}>Buy</Button>
      <Button size="touch" variant="secondary" disabled={!ready || holding === null || holding === "0"} onPointerDown={() => void TradeMoneySheet.preload()} onClick={(event) => openTrade("sell", event.currentTarget)}>Sell</Button>
    </div>
    {note || balancesNote || sellNote || buyNote ? <p className="text-end text-sm text-muted-foreground" role="note">{note ?? balancesNote ?? sellNote ?? buyNote}</p> : null}
    {session?.smartAccount && mountedDirection ? <TradeMoneySheet key={`${session.user.subject}:${session.smartAccount.address}:${mountedDirection}`} open={direction !== null} direction={mountedDirection} session={session} availableBaseUnits={mountedDirection === "buy" ? cash : holding} fetchAccountResource={account.fetchAccountResource} prepareMoneyAction={account.prepareMoneyAction} executeMoneyAction={account.executeMoneyAction} onClose={() => setDirection(null)} onClosed={() => { setMountedDirection(null); opener.current?.focus(); }} /> : null}
  </div>;
}
