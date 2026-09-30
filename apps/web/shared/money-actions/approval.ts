import { parseAddress, type Address } from "@/shared/chain/hex";
import type { MoneyActionCall } from "./types";

const APPROVE_SELECTOR = "0x095ea7b3";

export type DecodedMoneyActionApproval = {
  token: Address;
  spender: Address;
  amountBaseUnits: string;
  assetId: string;
};

export function decodeMoneyActionApproval(
  call: MoneyActionCall,
): DecodedMoneyActionApproval | null {
  if (!call.data.startsWith(APPROVE_SELECTOR)) return null;
  if (call.data.length !== 138 || !call.approval) return null;
  const spender = parseAddress(`0x${call.data.slice(34, 74)}`.toLowerCase());
  const token = parseAddress(call.to);
  if (!spender || !token) return null;
  return {
    token: token,
    spender: spender,
    amountBaseUnits: BigInt(`0x${call.data.slice(74)}`).toString(10),
    assetId: call.approval.assetId,
  };
}
