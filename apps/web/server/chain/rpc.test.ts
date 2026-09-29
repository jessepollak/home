import { describe, expect, test } from "bun:test";
import {
  BaseRpcError,
  BASE_RPC_MAX_RESPONSE_BYTES,
  baseRpc,
  baseRpcBatch,
  createBaseRpcClient,
  inspectBaseRpcUrl,
  parseRpcDataWord,
  parseRpcQuantity,
  resolveBaseRpcUrl,
  resolveEthereumRpcUrl,
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

async function rpcFailure(fetchImpl: typeof fetch, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return baseRpc("eth_blockNumber", [], {
    rpcUrl: "https://rpc.example.test",
    fetchImpl,
    ...options,
  }).then(() => null, (reason: unknown) => reason);
}

describe("Base RPC client", () => {
  test("resolves safe endpoints", () => {
    expect(resolveBaseRpcUrl("")).toBe("https://mainnet.base.org");
    expect(resolveBaseRpcUrl("http://127.0.0.1:8545/")).toBe("http://127.0.0.1:8545");
    expect(resolveEthereumRpcUrl("")).toBe("https://ethereum.reth.rs/rpc");
    expect(resolveEthereumRpcUrl("https://ethereum.example.test/rpc/")).toBe("https://ethereum.example.test/rpc");
    expect(inspectBaseRpcUrl("")).toEqual({ source: "public-default", hostClass: "public-base", protocol: "https" });
    expect(() => resolveBaseRpcUrl("http://example.com")).toThrow("loopback");
    expect(() => resolveEthereumRpcUrl("http://example.com")).toThrow("loopback");
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

  test.each([
    ["HTTP failure", () => new Response("unavailable", { status: 503 }), "Base RPC returned HTTP 503.", "http", 503],
    ["malformed JSON", () => new Response("{broken"), "Base RPC returned malformed JSON.", "invalid-response", null],
    ["oversized declared length", () => new Response("{}", { headers: { "content-length": String(BASE_RPC_MAX_RESPONSE_BYTES + 1) } }), "Base RPC returned an oversized response.", "invalid-response", null],
    ["oversized streamed body", () => Response.json({ pad: "x".repeat(BASE_RPC_MAX_RESPONSE_BYTES) }), "Base RPC returned an oversized response.", "invalid-response", null],
  ] as const)("maps %s to the RPC error contract", async (_case, response, message, code, httpStatus) => {
    const error = await rpcFailure((async () => response()) as unknown as typeof fetch);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message, code, httpStatus });
  });

  test("maps a thrown fetch to the transport error", async () => {
    const error = await rpcFailure((async () => { throw new Error("network failed"); }) as unknown as typeof fetch);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message: "The Base RPC transport failed.", code: "transport", httpStatus: null });
  });

  test("maps an unserializable request body to the transport error", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = await baseRpc("eth_call", [circular], {
      rpcUrl: "https://rpc.example.test",
      fetchImpl: (async () => { throw new Error("unexpected dispatch"); }) as unknown as typeof fetch,
    }).then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message: "The Base RPC transport failed.", code: "transport" });
  });

  test("aborts a stalled fetch at the deadline", async () => {
    let sawAbort = false;
    const error = await rpcFailure((async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        sawAbort = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    })) as typeof fetch, { timeoutMs: 10 });
    expect(sawAbort).toBe(true);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message: "The Base RPC request timed out or was aborted.", code: "aborted" });
  });

  test("does not dispatch with an already-aborted signal", async () => {
    let calls = 0;
    const error = await rpcFailure((async () => { calls += 1; throw new Error("unexpected dispatch"); }) as unknown as typeof fetch, { signal: AbortSignal.abort() });
    expect(calls).toBe(0);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message: "The Base RPC request timed out or was aborted.", code: "aborted" });
  });

  test.each([0, 30_001])("rejects the invalid timeout %p before dispatch", async (timeoutMs) => {
    let calls = 0;
    const error = await rpcFailure((async () => { calls += 1; throw new Error("unexpected dispatch"); }) as unknown as typeof fetch, { timeoutMs });
    expect(calls).toBe(0);
    expect(error).toBeInstanceOf(BaseRpcError);
    expect(error).toMatchObject({ message: "The Base RPC timeout must be 1-30000ms.", code: "invalid-response" });
  });
});
