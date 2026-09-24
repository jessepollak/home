"use client";

import { useEffect, useMemo, useState } from "react";
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
import { selectVaultPositions } from "@/shared/balances/select";
import {
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
} from "./portfolio-summary";
import { savingsTeaserApyLabel } from "./savings-teaser-apy";

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;

export function useSavingsRateLabel(regionId: RegionId): string | null {
  const account = useAccountWallet();
  const session = account.status === "verified" ? account.session : null;
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
  const metadataFetchedAt = metadataQuery.data?.source.fetchedAt ?? null;
  useEffect(() => {
    if (!metadataFetchedAt) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRateNowMs(Date.now());
    });
    return () => {
      active = false;
    };
  }, [metadataFetchedAt]);

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

  if (!metadataQuery.data) return null;
  return savingsTeaserApyLabel({
    summary,
    candidates: metadataQuery.data.candidates,
    metadata: metadataQuery.data,
    nowMs: rateNowMs,
  });
}
