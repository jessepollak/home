import { describe, expect, test } from "bun:test";
import { BaseRpcError } from "./rpc";
import { readsToken0 } from "./pair";

const token = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

const rpcError = (message: string, rpcCode: number | null) => async (): Promise<never> => {
  throw new BaseRpcError(message, { code: "rpc", rpcCode });
};

describe("pair token0 check", () => {
  test.each([
    ["execution reverted", rpcError("Base RPC rejected the request: execution reverted", -32000), false],
    ["revert code 3", rpcError("Base RPC rejected the request.", 3), false],
    ["internal RPC failure", rpcError("Base RPC rejected the request: internal error", -32603), null],
    ["rate limit", rpcError("Base RPC rejected the request: rate limited", -32005), null],
    ["timeout", async (): Promise<never> => { throw new BaseRpcError("timed out", { code: "aborted" }); }, null],
    ["undecodable bytes", async (): Promise<string> => "0x", false],
    ["decoded address", async (): Promise<string> => `0x${"0".repeat(24)}${other.slice(2)}`, true],
    ["invalid response type", async (): Promise<number> => 42, null],
  ] as const)("classifies %s", async (_name, read, expected) => {
    expect(await readsToken0(token, read)).toBe(expected);
  });

  test("calls token0 at latest on the requested address", async () => {
    const calls: Array<[string, readonly unknown[]]> = [];
    await readsToken0(token, async (method, params) => { calls.push([method, params]); return "0x"; });
    expect(calls).toEqual([["eth_call", [{ to: token, data: "0x0dfe1681" }, "latest"]]]);
  });
});
