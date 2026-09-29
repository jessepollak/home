import type { TradeMoneyActionMetadata } from "./contract";

export type TradeCustomerAmounts = {
  spendBaseUnits: string;
  expectedReceiveBaseUnits: string;
  minimumReceiveBaseUnits: string;
  operatorFeeBaseUnits: string | null;
};

export function tradeCustomerAmounts(metadata: TradeMoneyActionMetadata): TradeCustomerAmounts {
  const fee = metadata.operatorFee ? BigInt(metadata.operatorFee.amountBaseUnits) : BigInt(0);
  const from = BigInt(metadata.fromAmountBaseUnits);
  const expected = BigInt(metadata.expectedToAmountBaseUnits);
  const minimum = BigInt(metadata.minimumToAmountBaseUnits);
  const operatorFeeBaseUnits = metadata.operatorFee ? metadata.operatorFee.amountBaseUnits : null;
  if (metadata.direction === "buy") {
    return { spendBaseUnits: (from + fee).toString(), expectedReceiveBaseUnits: expected.toString(), minimumReceiveBaseUnits: minimum.toString(), operatorFeeBaseUnits };
  }
  return { spendBaseUnits: from.toString(), expectedReceiveBaseUnits: (expected - fee).toString(), minimumReceiveBaseUnits: (minimum - fee).toString(), operatorFeeBaseUnits };
}
