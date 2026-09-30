"use client";

import { useCallback, useMemo } from "react";
import { useAccountWallet } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { useNow } from "@/client/time/use-now";
import type { RegionId } from "@/config/regions";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import { selectVaultPositions } from "@/shared/balances/select";
import {
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
} from "./portfolio-summary";
import { savingsTeaserApyLabel } from "./savings-teaser-apy";
import { useSavingsVaults } from "./use-savings-vaults";

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;

export function useSavingsRateLabel(regionId: RegionId, regionReady = true): string | null {
  const account = useAccountWallet();
  const session = account.verification ? account.session : null;
  const balancesSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
        accountProvider: session.accountProvider,
      }
    : null;
  const balances = useBalances(balancesSession, regionId, account.fetchBalances, {
    enabled: account.verification === "server" && regionReady,
  });
  const positions = balances.snapshot ? selectVaultPositions(balances.snapshot) : null;
  const metadataQuery = useSavingsVaults();
  const metadata = metadataQuery.data;
  const nextDeadline = useCallback(
    (nowMs: number) => metadata
      ? nextSavingsRateExpiryAt(metadata.candidates, metadata.source.fetchedAt, nowMs)
      : null,
    [metadata],
  );
  const rateNowMs = useNow(metadata?.source.fetchedAt ?? null, nextDeadline);

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
    regionId,
    summary,
    candidates: metadataQuery.data.candidates,
    metadata: metadataQuery.data,
    nowMs: rateNowMs,
  });
}
