import { selectSendable } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MoneyAssetPrice } from "@/client/money-modal";

export type SendAvailability = readonly (TransferAssetAvailability & {
  imageUrl?: string;
  price: MoneyAssetPrice | null;
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
): SendAvailability {
  return selectSendable(snapshot).map((asset) => {
    const unitValue = snapshot.holdings.find((holding) => holding.id === asset.id && holding.key === asset.assetKey)?.unitValue;
    return {
      ...asset,
      price: unitValue ? { currency: unitValue.currency, perUnit: unitValue.amount } : null,
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
    };
  });
}
