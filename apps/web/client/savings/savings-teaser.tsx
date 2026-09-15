"use client";

import { useEffect, useMemo, useState } from "react";
import { PiggyBank } from "lucide-react";
import { HomeProductTile } from "@/client/home/product-tile";
import { MoneyTicker } from "@/components/money-ticker";
import { useAccountWallet } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import type { RegionId } from "@/config/regions";
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
import {
  savingsTeaserApyLabel,
  savingsTeaserBalanceLabel,
} from "./savings-teaser-apy";

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;

export function SavingsTeaser({
  headingId = "save-heading",
  onOpen,
  regionId,
}: {
  headingId?: string;
  onOpen: () => void;
  regionId: RegionId;
}) {
  const account = useAccountWallet();
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
  const balances = useBalances(balancesSession, regionId, account.fetchBalances);
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

  if (loading) {
    return (
      <HomeProductTile
        actionLabel="Earn"
        busy
        headingId={headingId}
        icon={<PiggyBank className="size-4" aria-hidden="true" />}
        onOpen={onOpen}
        primary="Earn"
        secondary="Loading savings rate…"
        title="Save"
      />
    );
  }

  const balance = summary?.balance.status === "available" ? summary.balance : null;
  const hasSavings = Boolean(
    sessionKey && balance && BigInt(balance.totalBaseUnits) > BigInt(0),
  );
  const knownEmpty = !sessionKey || balance?.totalBaseUnits === "0";
  const savedSubtotal = balances.snapshot ? presentSavedSubtotal(balances.snapshot) : null;
  const savingsAmount = savingsTeaserBalanceLabel({
    summary,
    savedSubtotal,
    regionId,
  });
  const description = metadataQuery.data
    ? savingsTeaserApyLabel({
        summary,
        candidates: metadataQuery.data.candidates,
        metadata: metadataQuery.data,
        nowMs: rateNowMs,
      })
    : null;
  const primary = hasSavings
    ? <MoneyTicker value={savingsAmount} align="start" reserveDigits={false} />
    : knownEmpty
      ? "Earn"
      : "Save";
  const secondary = description ?? (metadataQuery.isError ? "Savings unavailable" : "Savings rate unavailable");

  return (
    <HomeProductTile
      actionLabel={hasSavings ? "Manage" : "Earn"}
      headingId={headingId}
      icon={<PiggyBank className="size-4" aria-hidden="true" />}
      onOpen={onOpen}
      primary={primary}
      secondary={secondary}
      title="Save"
    />
  );
}
