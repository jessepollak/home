import { describe, expect, test } from "bun:test";
import {
  BaseRpcError,
  baseRpc,
  baseRpcBatch,
  createBaseRpcClient,
  inspectBaseRpcUrl,
  parseRpcDataWord,
  parseRpcQuantity,
  resolveBaseRpcUrl,
} from "./rpc";

type FixtureRequest = { id: number; method: string; params: unknown[] };
type FixtureBody = FixtureRequest | FixtureRequest[];

function rpcFetch(responder: (body: FixtureBody) => unknown): typeof fetch {
  return (async (_input, init) => Response.json(
    responder(JSON.parse(String(init?.body)) as FixtureBody),
  )) as typeof fetch;
}
function single(body: FixtureBody): FixtureRequest {
  if (Array.isArray(body)) throw new Error("expected single request");
  return body;
}
function batch(body: FixtureBody): FixtureRequest[] {
  if (!Array.isArray(body)) throw new Error("expected batch request");
  return body;
}

describe("Base RPC client", () => {
  test("resolves safe endpoints", () => {
    expect(resolveBaseRpcUrl("")).toBe("https://mainnet.base.org");
    expect(resolveBaseRpcUrl("http://127.0.0.1:8545/")).toBe("http://127.0.0.1:8545");
    expect(inspectBaseRpcUrl("")).toEqual({ source: "public-default", hostClass: "public-base", protocol: "https" });
    expect(() => resolveBaseRpcUrl("http://example.com")).toThrow("loopback");
  });

  test("unwraps singles and preserves exact quantities", async () => {
    const result = await baseRpc("eth_blockNumber", [], {
      rpcUrl: "https://rpc.example.test",
      fetchImpl: rpcFetch((body) => ({ jsonrpc: "2.0", id: single(body).id, result: "0xffffffffffffffff" })),
    });
    expect(parseRpcQuantity(result, "block")).toBe(BigInt("18446744073709551615"));
    expect(parseRpcDataWord(`0x${"f".repeat(64)}`, "word")).toBe((BigInt(1) << BigInt(256)) - BigInt(1));
  });

  test("matches batch responses by ID and supports partial reads", async () => {
    const fetchImpl = rpcFetch((body) => {
      const requests = batch(body);
      return [
        { jsonrpc: "2.0", id: requests[1]!.id, result: "second" },
        { jsonrpc: "2.0", id: requests[0]!.id, result: "first" },
      ];
    });
    await expect(baseRpcBatch([
      { id: 10, method: "a", params: [] },
      { id: 11, method: "b", params: [] },
    ], { rpcUrl: "https://rpc.example.test", fetchImpl })).resolves.toEqual(["first", "second"]);

    const partial = await baseRpcBatch([
      { id: 20, method: "a", params: [] },
      { id: 21, method: "b", params: [] },
    ], {
      rpcUrl: "https://rpc.example.test",
      fetchImpl: rpcFetch((body) => [{ jsonrpc: "2.0", id: batch(body)[0]!.id, result: "first" }]),
      allowPartial: true,
    });
    expect(partial).toEqual(["first", null]);
  });

  test("guards Base chain once per reader", async () => {
    const valid = createBaseRpcClient({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: rpcFetch((body) => ({ jsonrpc: "2.0", id: single(body).id, result: "0x2105" })),
    });
    await expect(valid.assertBaseChain()).resolves.toBeUndefined();
    const wrong = createBaseRpcClient({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: rpcFetch((body) => ({ jsonrpc: "2.0", id: single(body).id, result: "0x1" })),
    });
    await expect(wrong.assertBaseChain()).rejects.toBeInstanceOf(BaseRpcError);
  });
});
