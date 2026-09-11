import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { Address } from "@/shared/savings/types";

// ERC-20 and ERC-4626 selectors from the canonical interfaces used by Morpho Vault V1.
export const SELECTOR = {
  asset: "0x38d52e0f",
  decimals: "0x313ce567",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  fee: "0xddca3f43",
  maxDeposit: "0x402d267d",
  previewDeposit: "0xef8b30f7",
  deposit: "0x6e553f65",
  maxWithdraw: "0xce96cb77",
  previewWithdraw: "0x0a28a477",
  withdraw: "0xb460af94",
} as const;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;

export function encodeNoArgs(selector: `0x${string}`): `0x${string}` {
  return selector;
}

export function encodeAddressCall(
  selector: `0x${string}`,
  address: Address,
): `0x${string}` {
  return `${selector}${addressWord(address)}`;
}

export function encodeTwoAddressCall(
  selector: `0x${string}`,
  first: Address,
  second: Address,
): `0x${string}` {
  return `${selector}${addressWord(first)}${addressWord(second)}`;
}

export function encodeUintCall(
  selector: `0x${string}`,
  value: bigint,
): `0x${string}` {
  return `${selector}${uintWord(value)}`;
}

export function encodeUintAddressCall(
  selector: `0x${string}`,
  value: bigint,
  address: Address,
): `0x${string}` {
  return `${selector}${uintWord(value)}${addressWord(address)}`;
}

export function encodeAddressUintCall(
  selector: `0x${string}`,
  address: Address,
  value: bigint,
): `0x${string}` {
  return `${selector}${addressWord(address)}${uintWord(value)}`;
}

export function encodeUintThreeAddressCall(
  selector: `0x${string}`,
  value: bigint,
  first: Address,
  second: Address,
): `0x${string}` {
  return `${selector}${uintWord(value)}${addressWord(first)}${addressWord(second)}`;
}

export function encodeApproveCall(
  token: Address,
  spender: Address,
  amount: bigint,
  assetId: string,
): MoneyActionCall {
  return {
    to: token,
    data: encodeAddressUintCall(SELECTOR.approve, spender, amount),
    value: "0",
    approval: { assetId, spender },
  };
}

export function encodeDepositCall(
  vault: Address,
  amount: bigint,
  receiver: Address,
): MoneyActionCall {
  return {
    to: vault,
    data: encodeUintAddressCall(SELECTOR.deposit, amount, receiver),
    value: "0",
  };
}

export function encodeWithdrawCall(
  vault: Address,
  amount: bigint,
  receiver: Address,
  owner: Address,
): MoneyActionCall {
  return {
    to: vault,
    data: encodeUintThreeAddressCall(
      SELECTOR.withdraw,
      amount,
      receiver,
      owner,
    ),
    value: "0",
  };
}

export function parseUintWord(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !dataWordPattern.test(value)) {
    throw new SavingsActionAbiError(`Base RPC returned malformed ${label}.`);
  }
  return BigInt(value);
}

export function parseAddressWord(value: unknown, label: string): Address {
  if (typeof value !== "string" || !dataWordPattern.test(value)) {
    throw new SavingsActionAbiError(`Base RPC returned malformed ${label}.`);
  }
  const address = `0x${value.slice(-40)}`;
  if (!addressPattern.test(address)) {
    throw new SavingsActionAbiError(`Base RPC returned malformed ${label}.`);
  }
  return address.toLowerCase() as Address;
}

function addressWord(value: Address): string {
  if (!addressPattern.test(value)) {
    throw new SavingsActionAbiError("Cannot encode an invalid EVM address.");
  }
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function uintWord(value: bigint): string {
  if (value < BigInt(0) || value > UINT256_MAX) {
    throw new SavingsActionAbiError("Cannot encode an out-of-range uint256.");
  }
  return value.toString(16).padStart(64, "0");
}

export class SavingsActionAbiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavingsActionAbiError";
  }
}
