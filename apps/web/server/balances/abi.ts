import "server-only";

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

export const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11" as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
] as const;

export const vaultAbi = [
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ name: "assets", type: "uint256" }] },
] as const;

export const multicallAbi = [{
  type: "function", name: "aggregate3", stateMutability: "payable",
  inputs: [{ name: "calls", type: "tuple[]", components: [
    { name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" },
  ] }],
  outputs: [{ name: "returnData", type: "tuple[]", components: [
    { name: "success", type: "bool" }, { name: "returnData", type: "bytes" },
  ] }],
}] as const;

export type ContractCall = { target: `0x${string}`; callData: Hex };
export type ContractResult = { success: boolean; returnData: Hex };

export function encodeAggregate3(calls: readonly ContractCall[]): Hex {
  return encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [calls.map((call) => ({ ...call, allowFailure: true }))] });
}

export function decodeAggregate3(value: unknown): ContractResult[] {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error("Invalid multicall response.");
  return decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", data: value as Hex }).map(({ success, returnData }) => ({ success, returnData }));
}

export function decodeBalance(data: Hex): bigint | null {
  try { return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data }); }
  catch { return null; }
}
