"use client";

import { useEffect, useMemo, useState } from "react";
import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { MoneyTicker } from "@/components/money-ticker";
import { useAccountWallet } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import {
  publicQueryKey,
  useHomeQuery,
} from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import { parseVaultsResult } from "@/shared/savings/contracts/vaults";
import { presentSavedSubtotal } from "@/shared/balances/present";
import { selectVaultPositions } from "@/shared/balances/select";
import {
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
} from "./portfolio-summary";
import { savingsTeaserApyLabel } from "./savings-teaser-apy";
import { ShimmerRows } from "@/client/home/panel-shared";

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;

export function SavingsTeaser({ onOpen }: { onOpen: () => void }) {
  const account = useAccountWallet();
  const region = usePresentationRegionId();
  const session = account.status === "verified" ? account.session : null;
  const sessionKey = session?.smartAccount ? session.smartAccount.address : null;
  const balancesSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
        accountProvider: session.accountProvider,
      }
    : null;
  const balances = useBalances(balancesSession, region, account.fetchBalances);
  const positions = balances.snapshot ? selectVaultPositions(balances.snapshot) : null;
  const [rateNowMs, setRateNowMs] = useState(() => Date.now());

  const metadataQuery = useHomeQuery({
    queryKey: publicQueryKey("savings-vaults"),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/savings/vaults", {
        headers: { ...deploymentHeaders(), accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error("Vault request failed");
      return response.json();
    },
    select: (value) => {
      const data = parseVaultsResult(value);
      if (!data) throw new Error("Savings vault metadata is invalid.");
      return data;
    },
  });
  useEffect(() => {
    const metadata = metadataQuery.data;
    if (!metadata) return;
    const expiresAt = nextSavingsRateExpiryAt(
      metadata.candidates,
      metadata.source.fetchedAt,
      rateNowMs,
    );
    if (expiresAt === null || expiresAt <= rateNowMs) return;
    const timeout = window.setTimeout(() => setRateNowMs(Date.now()), expiresAt - rateNowMs);
    return () => window.clearTimeout(timeout);
  }, [metadataQuery.data, rateNowMs]);

  const summary = useMemo(() => {
    if (!metadataQuery.data || !positions) return null;
    return summarizeSavingsPortfolio({
      supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
      requiredAsset: metadataQuery.data.asset ?? BASE_USDC_ASSET,
      candidates: metadataQuery.data.candidates,
      positions,
      metadataFetchedAt: metadataQuery.data.source.fetchedAt,
      metadataStale: metadataQuery.data.stale,
      nowMs: rateNowMs,
    });
  }, [metadataQuery.data, positions, rateNowMs]);
  // A restoring/validating session is unknown, not zero: keep the shimmer until the owner is known.
  const sessionSettling = account.status === "restoring" || account.status === "validating";
  const loading = sessionSettling ||
    (!metadataQuery.data && !metadataQuery.isError) ||
    Boolean(sessionKey && balances.status === "loading");

  if (loading) return <ShimmerRows count={1} />;

  const balance = summary?.balance.status === "available" ? summary.balance : null;
  const isEmpty = balance?.totalBaseUnits === "0" || !sessionKey;
  const savedSubtotal = balances.snapshot ? presentSavedSubtotal(balances.snapshot) : null;
  const title = isEmpty
    ? "Nothing saved yet"
    : balance
      ? <MoneyTicker value={savedSubtotal ?? "—"} align="start" reserveDigits={false} />
      : <MoneyTicker value="—" align="start" reserveDigits={false} />;
  const description = metadataQuery.data && (summary || !sessionKey)
    ? savingsTeaserApyLabel({
        summary,
        candidates: metadataQuery.data.candidates,
        metadata: metadataQuery.data,
        nowMs: rateNowMs,
      })
    : null;

  return (
    <Item
      render={<Button variant="ghost" type="button" />}
      size="sm"
      className="flex-nowrap cursor-pointer items-center border-0 py-2 text-left hover:bg-muted"
      onClick={onOpen}
      aria-describedby="save-teaser-hint"
    >
      <span id="save-teaser-hint" hidden>Open Save</span>
      <ItemMedia variant="image" className="size-8 self-center translate-y-0 rounded-full bg-muted">
        <PiggyBank className="size-4 text-muted-foreground" aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="tabular-nums">{title}</ItemTitle>
        {description ? <ItemDescription className="text-xs text-muted-foreground">{description}</ItemDescription> : null}
      </ItemContent>
      <ItemActions className="shrink-0 text-sm font-medium text-muted-foreground" aria-hidden="true">
        Earn <span>›</span>
      </ItemActions>
    </Item>
  );
}
