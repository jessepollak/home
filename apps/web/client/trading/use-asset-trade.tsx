"use client";

import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { isServerVerified, useOptionalAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { uiBoundary } from "@/client/account/owner-keys";
import { useBalances } from "@/client/balances";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { deferSheet, useIdlePreload } from "@/client/money-modal/deferred-sheet";
import { moneySheetLoading } from "@/client/money-modal";
import { browserHomeQueryClient } from "@/client/query/query-client";
import { selectBalanceBaseUnits } from "@/shared/balances/select";
import { useProductOffering } from "@/client/home/product-offering";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import type { TradeDirection, TradeToken } from "@/shared/trading/contract";
import { tradeAvailabilityOptions, tradeAvailabilityResult } from "./use-trade-availability";

const TradeMoneySheet = deferSheet(() => import("./trade-money-dialog").then((module) => module.TradeMoneyDialog),
  (props) => moneySheetLoading({ title: `${props.direction === "buy" ? "Buy" : "Sell"} ${props.assetName}`, titleId: "trade-action-title", closeLabel: "Close trade dialog", onCancel: props.onClose, onClosed: props.onClosed }));
const unavailableResource: AccountWalletClient["fetchAccountResource"] = async () => { throw new Error("Account unavailable"); };
const unavailableBalances: AccountWalletClient["fetchBalances"] = async () => { throw new Error("Account unavailable"); };

export type TradeCandidate = { assetId: string; assetName: string };
type Options = { session?: VerifiedAccountSession | null; regionId?: RegionId; onFallbackFocus?: () => void };

export function useAssetTrade(candidates: readonly TradeCandidate[], { session: expectedSession, regionId, onFallbackFocus }: Options = {}) {
  const account = useOptionalAccountWallet();
  const investOffered = useProductOffering().products.invest === "on";
  const walletOwner = account ? uiBoundary(account) : null;
  const verified = walletOwner !== null && account && isServerVerified(account) ? account.session : null;
  const [mountedOwner, setMountedOwner] = useState(walletOwner);
  const [direction, setDirection] = useState<TradeDirection | null>(null);
  const [mounted, setMounted] = useState<{ owner: string; assetId: string; assetName: string; token: TradeToken; direction: TradeDirection } | null>(null);
  if (mountedOwner !== walletOwner) {
    setMountedOwner(walletOwner);
    setMounted(null);
    setDirection(null);
  }
  const keepMountedSession = expectedSession === null && !!verified?.smartAccount && mounted?.owner === walletOwner;
  const session = expectedSession === undefined || (verified?.user.subject === expectedSession?.user.subject && verified?.smartAccount?.address === expectedSession?.smartAccount?.address) || keepMountedSession
    ? verified : null;
  const owner = session?.smartAccount ? walletOwner : null;
  const region = usePresentationRegionId(regionId);
  const activeCandidates = mounted && mounted.owner === owner && !candidates.some((entry) => entry.assetId === mounted.assetId)
    ? [...candidates, { assetId: mounted.assetId, assetName: mounted.assetName }] : candidates;
  const queries = useQueries({ queries: activeCandidates.map((entry) => tradeAvailabilityOptions(session, entry.assetId, account?.fetchAccountResource ?? unavailableResource)) }, browserHomeQueryClient());
  const availability = new Map(activeCandidates.map((entry, index) => [entry.assetId, tradeAvailabilityResult(!!session?.smartAccount, queries[index]!)] as const));
  const balances = useBalances(session?.smartAccount ? {
    subject: session.user.subject,
    smartAccountAddress: session.smartAccount.address,
    chainId: session.smartAccount.chainId,
    accountProvider: session.accountProvider,
  } : null, region, account?.fetchBalances ?? unavailableBalances);
  const usableBalances = balances.status === "ready" && !balances.snapshot.stale && !balances.refreshError;
  const cash = usableBalances ? selectBalanceBaseUnits(balances.snapshot, "usdc") : null;
  const states = new Map(candidates.map(({ assetId }) => {
    const available = availability.get(assetId);
    const state = !account || !session?.smartAccount || available?.status === "unavailable" ||
      (!investOffered || (available?.status === "available" && available.buy === "blocked")) || balances.status === "error" ||
      (balances.status === "ready" && (!usableBalances || cash === null)) ? "none"
      : available === null || balances.status === "loading" ? "pending"
        : cash === "0" ? "zero" : "ready";
    return [assetId, state] as const;
  }));
  const opener = useRef<HTMLButtonElement | null>(null);
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
    opener.current = null;
  }, [walletOwner]);
  useIdlePreload(TradeMoneySheet.preload, candidates.some(({ assetId }) => eligible(assetId, "buy") !== null || eligible(assetId, "sell") !== null));
  function eligible(assetId: string, mode: TradeDirection) {
    const candidate = candidates.find((entry) => entry.assetId === assetId);
    const available = availability.get(assetId);
    if (!owner || !candidate || available?.status !== "available" || !session?.smartAccount ||
      (mode === "buy" ? states.get(assetId) !== "ready" : available.balanceBaseUnits === "0")) return null;
    return { owner, assetId, assetName: candidate.assetName, token: available.token, direction: mode };
  }
  function intent(assetId: string, mode: TradeDirection) {
    void TradeMoneySheet.preload();
    const next = eligible(assetId, mode);
    if (next && direction === null && !closing.current) setMounted(next);
  }
  function open(assetId: string, mode: TradeDirection, button: HTMLButtonElement) {
    const next = eligible(assetId, mode);
    if (!next) return;
    opener.current = button;
    closing.current = false;
    setMounted(next);
    setDirection(mode);
  }
  const mountedAvailability = mounted ? availability.get(mounted.assetId) : null;
  const holding = mountedAvailability?.status === "available" ? mountedAvailability.balanceBaseUnits : null;
  const pricedHolding = usableBalances && mounted
    ? balances.snapshot.holdings.find((entry) => entry.kind === "erc20" && entry.decimals === mounted.token.decimals &&
      entry.contractAddress?.toLowerCase() === mounted.token.address.toLowerCase())
    : undefined;
  const assetPrice = pricedHolding?.unitValue ? { currency: pricedHolding.unitValue.currency, perUnit: pricedHolding.unitValue.amount } : null;
  const sheet = session?.smartAccount && account && mounted?.owner === owner ? <TradeMoneySheet
    key={`${owner}:${mounted.assetId}:${mounted.direction}`} open={direction !== null} direction={mounted.direction} session={session}
    assetName={mounted.assetName} token={mounted.token} availableBaseUnits={mounted.direction === "buy" ? cash : holding} assetPrice={assetPrice}
    fetchAccountResource={account.fetchAccountResource} prepareMoneyAction={account.prepareMoneyAction}
    executeMoneyAction={account.executeMoneyAction} onClose={() => { closing.current = true; setDirection(null); }}
    onClosed={() => {
      closing.current = false;
      setMounted(null);
      if (opener.current?.isConnected) opener.current.focus();
      else onFallbackFocus?.();
    }} /> : null;
  return { availability, balances, usableBalances, cash, states, session, account, sheet, open, intent };
}
