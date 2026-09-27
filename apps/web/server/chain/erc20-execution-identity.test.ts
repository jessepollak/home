import { describe, expect, test } from "bun:test";
import { encodeAbiParameters } from "viem";
import type { Address } from "@/shared/trading/server-types";
import { BaseRpcError } from "./rpc";
import { readErc20ExecutionIdentity, TokenChainUnavailable, TokenUnreadable } from "./erc20-execution-identity";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const HOLDER = "0x2222222222222222222222222222222222222222" as Address;
const word = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
type ReadTarget = "eth_getCode" | "decimals" | "balanceOf" | "symbol";
function readWith({ code = "0x6000", decimals = word(18), balance = word(20), symbol = encodeAbiParameters([{ type: "string" }], ["ABC"]), failure, failureAt }: {
  code?: unknown; decimals?: unknown; balance?: unknown; symbol?: unknown; failure?: Error; failureAt?: ReadTarget;
} = {}) {
  const calls: Array<[string, readonly unknown[]]> = [];
  const read = async (method: string, params: readonly unknown[]) => {
    calls.push([method, params]);
    const selector = method === "eth_call" ? (params[0] as { data: string }).data.slice(0, 10) : "";
    const target = method === "eth_getCode" ? "eth_getCode" : selector === "0x313ce567" ? "decimals" : selector === "0x70a08231" ? "balanceOf" : "symbol";
    if (failure && (!failureAt || failureAt === target)) throw failure;
    if (method === "eth_getCode") return code;
    return target === "decimals" ? decimals : target === "balanceOf" ? balance : symbol;
  };
  return { read, calls };
}

describe("ERC-20 execution identity", () => {
  test.each([6, 8, 18, 36])("reads %i decimals and balance directly from chain", async (decimals) => {
    const { read, calls } = readWith({ decimals: word(decimals) });
    expect(await readErc20ExecutionIdentity({ token: TOKEN, holder: HOLDER, blockTag: "latest", read, configuredDecimals: decimals }))
      .toEqual({ decimals, balance: BigInt(20), symbol: "ABC" });
    expect(calls.map((entry) => entry[1].at(-1))).toEqual(["latest", "latest", "latest", "latest"]);
  });
  test.each(["0x", null, "0x0"]) ("rejects no code: %p", async (code) => {
    await expect(readErc20ExecutionIdentity({ token: TOKEN, read: readWith({ code }).read })).rejects.toBeInstanceOf(TokenUnreadable);
  });
  test.each(["0x", word(37), null])("rejects malformed, reverting or excessive decimals: %p", async (decimals) => {
    await expect(readErc20ExecutionIdentity({ token: TOKEN, read: readWith({ decimals }).read })).rejects.toBeInstanceOf(TokenUnreadable);
  });
  test("rejects configured precision mismatch and malformed balance", async () => {
    await expect(readErc20ExecutionIdentity({ token: TOKEN, read: readWith().read, configuredDecimals: 8 })).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(readErc20ExecutionIdentity({ token: TOKEN, holder: HOLDER, read: readWith({ balance: "0x" }).read })).rejects.toBeInstanceOf(TokenUnreadable);
  });
  test.each(["0x", word(42), encodeAbiParameters([{ type: "string" }], ["not a symbol"]), null])("ignores unsafe display symbol: %p", async (symbol) => {
    expect((await readErc20ExecutionIdentity({ token: TOKEN, read: readWith({ symbol }).read })).symbol).toBeNull();
  });
  test.each([
    ["revert code 3", "decimals", new BaseRpcError("reverted", { code: "rpc", rpcCode: 3 }), TokenUnreadable],
    ["revert message", "balanceOf", new BaseRpcError("execution reverted", { code: "rpc", rpcCode: -32000 }), TokenUnreadable],
    ["revert on code read", "eth_getCode", new BaseRpcError("execution reverted", { code: "rpc", rpcCode: 3 }), TokenChainUnavailable],
    ["transport failure", "decimals", new BaseRpcError("offline", { code: "transport" }), TokenChainUnavailable],
  ] as const)("classifies %s on %s", async (_name, failureAt, failure, expected) => {
    await expect(readErc20ExecutionIdentity({ token: TOKEN, holder: HOLDER, read: readWith({ failureAt, failure }).read })).rejects.toBeInstanceOf(expected);
  });
  test("a reverting optional symbol leaves the identity readable without a symbol", async () => {
    const failure = new BaseRpcError("execution reverted", { code: "rpc", rpcCode: 3 });
    expect(await readErc20ExecutionIdentity({ token: TOKEN, holder: HOLDER, read: readWith({ failureAt: "symbol", failure }).read }))
      .toEqual({ decimals: 18, balance: BigInt(20), symbol: null });
  });
  test.each(["decimals", "balanceOf", "eth_getCode", "symbol"] as const)("classifies RPC outages on %s as chain unavailable", async (failureAt) => {
    for (const rpcCode of [-32005, -32603]) {
      const failure = new BaseRpcError("Base RPC rejected the request.", { code: "rpc", rpcCode });
      await expect(readErc20ExecutionIdentity({ token: TOKEN, holder: HOLDER, read: readWith({ failureAt, failure }).read }))
        .rejects.toBeInstanceOf(TokenChainUnavailable);
    }
  });
});
