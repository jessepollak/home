import "server-only";

import { encodeFunctionData, erc20Abi } from "viem";
import { OPERATOR_FEE_TOKEN, operatorFeeAmount, type OperatorFeePolicy, type OperatorFeeRecord } from "@/shared/fees/contract";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { TradeDirection } from "@/shared/trading/contract";
import { TradePreparationError } from "@/server/actions/kinds/trade/permit2";

type ProviderFee = { bps: number; recipient: `0x${string}` };
type FeeQuote = { fromAmount: bigint; operatorFee?: ProviderFee };
type FeeCollection = { record?: OperatorFeeRecord; call?: MoneyActionCall };

export interface TradeFeeStrategy {
  quote(direction: TradeDirection, amount: bigint, policy: OperatorFeePolicy): FeeQuote;
  collect(direction: TradeDirection, amount: bigint, minimumToAmount: bigint, policy: OperatorFeePolicy): FeeCollection;
}

function feeAmount(direction: TradeDirection, amount: bigint, minimum: bigint, policy: OperatorFeePolicy): bigint {
  return policy.recipient && policy.bps > 0 ? operatorFeeAmount(direction === "buy" ? amount : minimum, policy.bps) : BigInt(0);
}

export function createTradeFeeStrategy(collectedBy: OperatorFeeRecord["collectedBy"]): TradeFeeStrategy {
  return {
    quote(direction, amount, policy) {
      const fee = direction === "buy" ? feeAmount(direction, amount, BigInt(0), policy) : BigInt(0);
      const fromAmount = amount - fee;
      if (fromAmount <= BigInt(0)) throw new TradePreparationError("below-minimum");
      return {
        fromAmount,
        ...(collectedBy === "provider-native" && policy.bps > 0 && policy.recipient && (direction === "sell" || fee > BigInt(0))
          ? { operatorFee: { bps: policy.bps, recipient: policy.recipient } } : {}),
      };
    },
    collect(direction, amount, minimumToAmount, policy) {
      const fee = feeAmount(direction, amount, minimumToAmount, policy);
      if (fee === BigInt(0) || !policy.recipient) return {};
      if (direction === "sell" && fee >= minimumToAmount) throw new TradePreparationError("quote-rejected");
      const record: OperatorFeeRecord = {
        amountBaseUnits: fee.toString(), token: OPERATOR_FEE_TOKEN,
        bps: policy.bps, recipient: policy.recipient, collectedBy,
      };
      return collectedBy === "provider-native" ? { record } : {
        record,
        call: {
          to: OPERATOR_FEE_TOKEN.address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [policy.recipient, fee] }),
          value: "0",
        },
      };
    },
  };
}
