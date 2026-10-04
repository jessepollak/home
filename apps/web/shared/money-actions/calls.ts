import { parseAddress } from "@/shared/chain/hex";
import { isRecord } from "@/shared/guards";
import type { MoneyActionCall } from "@/shared/money-actions/types";

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_UINT256_DECIMAL_DIGITS = MAX_UINT256.toString().length;

function parseMoneyActionCall(call: unknown): MoneyActionCall | null {
  if (!isPlainRecord(call)) return null;
  const to = parseAddress(call.to);
  const data = typeof call.data === "string" && call.data.startsWith("0x") ? call.data.toLowerCase() : null;
  if (!to || /^0x0{40}$/.test(to) || data === null || !isHexData(data) || typeof call.value !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(call.value) || call.value.length > MAX_UINT256_DECIMAL_DIGITS ||
    BigInt(call.value) > MAX_UINT256) return null;

  let approval: MoneyActionCall["approval"];
  if (call.approval !== undefined) {
    if (!isPlainRecord(call.approval) || typeof call.approval.assetId !== "string") return null;
    const assetId = call.approval.assetId.trim();
    const spender = parseAddress(call.approval.spender);
    if (assetId.length < 1 || assetId.length > 200 || !spender || /^0x0{40}$/.test(spender)) return null;
    approval = { assetId, spender };
  }

  return {
    to,
    data,
    value: call.value,
    ...(approval ? { approval } : {}),
  };
}

export function parseMoneyActionCalls(value: unknown): MoneyActionCall[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const calls: MoneyActionCall[] = [];
  for (const call of value) {
    const parsed = parseMoneyActionCall(call);
    if (!parsed) return null;
    calls.push(parsed);
  }
  return calls;
}

function isHexData(value: string): value is `0x${string}` {
  return /^0x(?:[0-9a-f]{2})*$/.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
