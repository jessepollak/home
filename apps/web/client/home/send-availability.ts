import { selectSendable } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationTokenAmount, formatRelativeTime } from "@/shared/formatting";
import type { TransferAssetAvailability } from "@/shared/transfers/types";

export type SendAvailability = readonly (TransferAssetAvailability & {
  balanceAgeLabel?: string;
  imageUrl?: string;
})[];

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
