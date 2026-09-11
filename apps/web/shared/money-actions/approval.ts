import type { MoneyActionCall } from "./types";

const APPROVE_SELECTOR = "0x095ea7b3";
const addressPattern = /^0x[0-9a-f]{40}$/;

export type DecodedMoneyActionApproval = {
  token: `0x${string}`;
  spender: `0x${string}`;
  amountBaseUnits: string;
  assetId: string;
};

export function decodeMoneyActionApproval(
  call: MoneyActionCall,
): DecodedMoneyActionApproval | null {
  if (!call.data.startsWith(APPROVE_SELECTOR)) return null;
  if (call.data.length !== 138 || !call.approval) return null;
  const spender = `0x${call.data.slice(34, 74)}`.toLowerCase();
  if (!addressPattern.test(spender)) return null;
  return {
    token: call.to.toLowerCase() as `0x${string}`,
    spender: spender as `0x${string}`,
    amountBaseUnits: BigInt(`0x${call.data.slice(74)}`).toString(10),
    assetId: call.approval.assetId,
  };
}
