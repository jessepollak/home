import "server-only";

import { decodeFunctionResult, encodeFunctionData } from "viem";
import { isBaseRpcCallRevert } from "./rpc";

const token0Abi = [{ type: "function", name: "token0", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" }] as const;

type Read = (method: string, params: readonly unknown[]) => Promise<unknown>;

export async function readsToken0(address: `0x${string}`, read: Read): Promise<boolean | null> {
  let response: unknown;
  try {
    response = await read("eth_call", [{ to: address, data: encodeFunctionData({ abi: token0Abi, functionName: "token0" }) }, "latest"]);
  } catch (error) {
    return isBaseRpcCallRevert(error) ? false : null;
  }
  if (typeof response !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(response)) return null;
  try {
    decodeFunctionResult({ abi: token0Abi, functionName: "token0", data: response as `0x${string}` });
    return true;
  } catch {
    return false;
  }
}
