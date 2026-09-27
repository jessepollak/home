import "server-only";

import { decodeAbiParameters, encodeFunctionData, erc20Abi } from "viem";
import { MAX_TRADE_TOKEN_DECIMALS, isTradeTokenSymbol } from "@/shared/trading/contract";
import type { Address } from "@/shared/trading/server-types";
import { isBaseRpcCallRevert } from "./rpc";

export class TokenUnreadable extends Error {
  constructor() { super("Token execution identity is unreadable."); this.name = "TokenUnreadable"; }
}

export class TokenChainUnavailable extends Error {
  constructor() { super("Token chain read is unavailable."); this.name = "TokenChainUnavailable"; }
}

type Read = (method: string, params: readonly unknown[]) => Promise<unknown>;

export async function readErc20ExecutionIdentity({ token, holder, blockTag = "latest", read, configuredDecimals }: {
  token: Address;
  holder?: Address;
  blockTag?: string;
  read: Read;
  configuredDecimals?: number | null;
}): Promise<{ decimals: number; balance: bigint | null; symbol: string | null }> {
  async function call(method: string, params: readonly unknown[]): Promise<unknown> {
    try { return await read(method, params); }
    catch (error) {
      if (method === "eth_call" && isBaseRpcCallRevert(error)) throw new TokenUnreadable();
      throw new TokenChainUnavailable();
    }
  }
  async function tokenCall(data: `0x${string}`): Promise<unknown> {
    return call("eth_call", [{ to: token, data }, blockTag]);
  }
  const code = await call("eth_getCode", [token, blockTag]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new TokenUnreadable();
  const word = (value: unknown): bigint => {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TokenUnreadable();
    return BigInt(value);
  };
  const decimals = word(await tokenCall(encodeFunctionData({ abi: erc20Abi, functionName: "decimals" })));
  if (decimals > BigInt(MAX_TRADE_TOKEN_DECIMALS) || (configuredDecimals != null && decimals !== BigInt(configuredDecimals))) throw new TokenUnreadable();
  const balance = holder ? word(await tokenCall(encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] }))) : null;
  let symbol: string | null = null;
  let raw: unknown = null;
  try { raw = await tokenCall(encodeFunctionData({ abi: erc20Abi, functionName: "symbol" })); }
  catch (error) { if (!(error instanceof TokenUnreadable)) throw error; raw = null; }
  try {
    if (typeof raw === "string") {
      const decoded = decodeAbiParameters([{ type: "string" }], raw as `0x${string}`)[0];
      if (isTradeTokenSymbol(decoded)) symbol = decoded;
    }
  } catch { symbol = null; }
  return { decimals: Number(decimals), balance, symbol };
}
