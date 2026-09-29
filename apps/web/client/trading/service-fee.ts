import type { OperatorFeeRecord } from "@/shared/fees/operator-fee";
import { formatUsdStablecoinAmount } from "@/shared/formatting";
import type { RegionId } from "@/config/regions";

export const SERVICE_FEE_LABEL = "Service fee";

export function serviceFeeValue(fee: OperatorFeeRecord, regionId?: RegionId): string {
  return `${formatUsdStablecoinAmount(fee.amountBaseUnits, fee.token.decimals, regionId)} (${fee.bps / 100}%)`;
}
