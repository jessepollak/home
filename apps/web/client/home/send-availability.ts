import { selectSendable } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import type { TransferAssetAvailability } from "@/shared/transfers/types";

export type SendAvailability = readonly TransferAssetAvailability[];

export function deriveSendAvailability(snapshot: BalancesSnapshot): SendAvailability {
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
  }));
}
