import { getTransferAssets } from "@/shared/transfers/transfer-helpers";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import { parseAvailableDecimal } from "@/client/money-modal";
import { isAvailablePositive } from "@/client/money-modal/amount-units";
import type { HomeAssetBalanceItem } from "./home-types";

const transferAssetByKey = new Map(
  getTransferAssets().map((asset) => [asset.assetKey.toLowerCase(), asset]),
);

export type SendAvailability = readonly TransferAssetAvailability[];

export function deriveSendAvailability(
  items: readonly HomeAssetBalanceItem[],
): SendAvailability {
  return items.flatMap((item) => {
    if (
      item.recognized === true ||
      item.tone === "error" ||
      item.displayBalance === "—" ||
      item.displayBalance === "Unavailable" ||
      !item.assetKey
    ) {
      return [];
    }
    const asset = transferAssetByKey.get(item.assetKey.toLowerCase());
    if (!asset) return [];
    const balanceLabel = item.displayContext ?? item.displayBalance;
    const parsedBalance = parseAvailableDecimal(balanceLabel);
    if (parsedBalance !== null && !isAvailablePositive(parsedBalance)) return [];
    return [{ ...asset, balanceLabel }];
  });
}
