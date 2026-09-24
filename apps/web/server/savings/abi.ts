import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import { encodeFunctionData, parseAbi } from "viem";
import type { Address } from "@/shared/savings/types";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";

export const SELECTOR = {
  asset: "0x38d52e0f",
  decimals: "0x313ce567",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  fee: "0xddca3f43",
  maxDeposit: "0x402d267d",
  previewDeposit: "0xef8b30f7",
  maxWithdraw: "0xce96cb77",
  previewWithdraw: "0x0a28a477",
  withdraw: "0xb460af94",
} as const;

export const MORPHO_BUNDLER3_ADDRESS = "0x6bfd8137e702540e7a42b74178a4a49ba43920c4" as const;
export const MORPHO_GENERAL_ADAPTER1_ADDRESS = "0xb98c948cfa24072e58935bc004a8a7b376ae746a" as const;

export const bundler3Abi = parseAbi([
  "function multicall((address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)[] bundle) payable",
]);
export const generalAdapter1Abi = parseAbi([
  "function erc20TransferFrom(address token, address receiver, uint256 amount)",
  "function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)",
]);

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

export function encodeBoundedDepositCall(
  vault: Address,
  amount: bigint,
  maxSharePriceE27: bigint,
  receiver: Address,
): MoneyActionCall {
  const bundle = [
    {
      to: MORPHO_GENERAL_ADAPTER1_ADDRESS,
      data: encodeFunctionData({
        abi: generalAdapter1Abi,
        functionName: "erc20TransferFrom",
        args: [BASE_USDC_ADDRESS, MORPHO_GENERAL_ADAPTER1_ADDRESS, amount],
      }),
      value: BigInt("0"),
      skipRevert: false,
      callbackHash: `0x${"00".repeat(32)}` as `0x${string}`,
    },
    {
      to: MORPHO_GENERAL_ADAPTER1_ADDRESS,
      data: encodeFunctionData({
        abi: generalAdapter1Abi,
        functionName: "erc4626Deposit",
        args: [vault, amount, maxSharePriceE27, receiver],
      }),
      value: BigInt("0"),
      skipRevert: false,
      callbackHash: `0x${"00".repeat(32)}` as `0x${string}`,
    },
  ];
  return {
    to: MORPHO_BUNDLER3_ADDRESS,
    data: encodeFunctionData({ abi: bundler3Abi, functionName: "multicall", args: [bundle] }),
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
