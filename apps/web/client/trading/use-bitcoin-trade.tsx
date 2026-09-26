"use client";

import { useRef, useState } from "react";
import { isServerVerified, useOptionalAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { selectBalanceBaseUnits, selectHolding } from "@/shared/balances/select";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import type { TradeDirection } from "@/shared/trading/contract";
import { useTradeAvailability } from "./use-trade-availability";

const TradeMoneySheet = deferSheet(() => import("./trade-money-dialog").then((module) => module.TradeMoneyDialog));
const unavailableResource: AccountWalletClient["fetchAccountResource"] = async () => { throw new Error("Account unavailable"); };
const unavailableBalances: AccountWalletClient["fetchBalances"] = async () => { throw new Error("Account unavailable"); };

type Options = { session?: VerifiedAccountSession | null; regionId?: RegionId; onFallbackFocus?: () => void };

export function useBitcoinTrade({ session: expectedSession, regionId, onFallbackFocus }: Options = {}) {
  const account = useOptionalAccountWallet();
  const verified = account && isServerVerified(account) ? account.session : null;
  const [mounted, setMounted] = useState<{ owner: string; direction: TradeDirection } | null>(null);
  const keepMountedSession = expectedSession === null && !!verified?.smartAccount && mounted?.owner === `${verified.user.subject}:${verified.smartAccount.address}`;
  const session = expectedSession === undefined || (verified?.user.subject === expectedSession?.user.subject && verified?.smartAccount?.address === expectedSession?.smartAccount?.address) || keepMountedSession
    ? verified : null;
  const region = usePresentationRegionId(regionId);
  const availability = useTradeAvailability(session, account?.fetchAccountResource ?? unavailableResource);
  const balances = useBalances(session?.smartAccount ? {
    subject: session.user.subject,
    smartAccountAddress: session.smartAccount.address,
    chainId: session.smartAccount.chainId,
    accountProvider: session.accountProvider,
  } : null, region, account?.fetchBalances ?? unavailableBalances);
  const usableBalances = balances.status === "ready" && !balances.snapshot.stale && !balances.refreshError;
  const cash = usableBalances ? selectBalanceBaseUnits(balances.snapshot, "usdc") : null;
  const holding = usableBalances ? selectBalanceBaseUnits(balances.snapshot, "cbbtc") : null;
  const unitValue = usableBalances ? selectHolding(balances.snapshot, "cbbtc")?.unitValue : null;
  const assetPrice = unitValue ? { currency: unitValue.currency, perUnit: unitValue.amount } : null;
  const [direction, setDirection] = useState<TradeDirection | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const owner = session?.smartAccount ? `${session.user.subject}:${session.smartAccount.address}` : null;
  const ready = availability?.status === "available" && !!session?.smartAccount;
  function open(mode: TradeDirection, button: HTMLButtonElement) {
    if (!owner || !ready) return;
    opener.current = button;
    setMounted({ owner, direction: mode });
    setDirection(mode);
  }
  const sheet = session?.smartAccount && account && mounted?.owner === owner ? <TradeMoneySheet
    key={`${owner}:${mounted.direction}`} open={direction !== null} direction={mounted.direction} session={session}
    availableBaseUnits={mounted.direction === "buy" ? cash : holding} assetPrice={assetPrice}
    fetchAccountResource={account.fetchAccountResource} prepareMoneyAction={account.prepareMoneyAction}
    executeMoneyAction={account.executeMoneyAction} onClose={() => setDirection(null)}
    onClosed={() => {
      setMounted(null);
      if (opener.current?.isConnected) opener.current.focus();
      else onFallbackFocus?.();
    }} /> : null;
  return {
    availability, balances, usableBalances, cash, holding, ready, hasAccount: !!account,
    open, preload: () => void TradeMoneySheet.preload(), sheet,
  };
}
