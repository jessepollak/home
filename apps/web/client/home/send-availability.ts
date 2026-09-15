import { selectSendable } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationTokenAmount, formatRelativeTime } from "@/shared/formatting";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";

export type SendAvailability = readonly (TransferAssetAvailability & {
  balanceAgeLabel?: string;
  imageUrl?: string;
})[];

export function deriveAssetMarkResolution(
  snapshot: BalancesSnapshot | null,
  pending = false,
): AssetMarkResolution {
  return {
    images: Object.fromEntries(
      (snapshot?.holdings ?? []).map((holding) => [holding.key, holding.imageUrl ?? null]),
    ),
    pending,
  };
}

export function deriveSendAvailability(
  snapshot: BalancesSnapshot,
  nowMs = Date.now(),
): SendAvailability {
  const balanceAgeLabel = snapshot.stale === true
    ? `Updated ${formatRelativeTime(snapshot.fetchedAt, nowMs)}`
    : undefined;
  return selectSendable(snapshot).map((asset) => ({
    ...asset,
    balanceLabel: formatPresentationTokenAmount(
      BigInt(asset.balanceBaseUnits),
      asset.decimals,
      asset.symbol,
      {
        cashCurrency: asset.cashCurrency,
        category: asset.kind === "native" ? "crypto" : undefined,
        regionId: snapshot.region,
      },
    ),
    ...(balanceAgeLabel ? { balanceAgeLabel } : {}),
  }));
}
