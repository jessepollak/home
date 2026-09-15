import { describe, expect, test } from "bun:test";
import {
  CoinbaseSmartAccountBatchSimulationError,
  applyCoinbaseBatchGasHeadroom,
  createCoinbaseSmartAccountBatchEstimator,
  createCoinbaseSmartAccountBatchSimulator,
  encodeCoinbaseExecuteBatch,
} from "./coinbase-smart-account";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

function word(value: string): string {
  return value.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function sourceFetch(options: {
  accountCode?: string;
  implementationCode?: string;
  confirmedHash?: `0x${string}`;
} = {}) {
  const requests: Array<{ id: number; method: string; params: unknown[] }> = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    requests.push(request);
    const result = request.id === 21 ? options.accountCode ?? "0x6001"
      : request.id === 22 ? `0x${word(IMPLEMENTATION)}`
      : request.id === 23 ? options.implementationCode ?? "0x6002"
      : request.id === 24 ? "0x"
      : {
          number: "0x64",
          hash: options.confirmedHash ?? BLOCK_HASH,
          timestamp: "0x64",
        };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
  return { requests, fetchImpl: fetchImpl as typeof fetch };
}

describe("Coinbase smart-account confirm-time gas estimate", () => {
  test("estimates the exact ordered executeBatch envelope at latest", async () => {
    const requests: Array<{ id: number; method: string; params: unknown[] }> = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      requests.push(request);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: request.id === 31 ? "0x6001" : "0x186a0" });
    }) as typeof fetch;
    const calls = [
      { to: IMPLEMENTATION, value: "1", data: "0x1234" as const },
      { to: ACCOUNT, value: "0", data: "0xabcd" as const },
    ];

    await expect(createCoinbaseSmartAccountBatchEstimator({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).estimateBatch(calls, ACCOUNT)).resolves.toBe(BigInt(100_000));
    expect(requests.map(({ id, method, params }) => ({ id, method, params }))).toEqual([
      { id: 31, method: "eth_getCode", params: [ACCOUNT, "latest"] },
      { id: 32, method: "eth_estimateGas", params: [{
        from: ACCOUNT,
        to: ACCOUNT,
        data: encodeCoinbaseExecuteBatch(calls),
        value: "0x0",
      }, "latest"] },
    ]);
  });

  test("applies percentage, absolute floor, cap, and rejects raw estimates over cap", () => {
    expect(applyCoinbaseBatchGasHeadroom(BigInt(100_000))).toBe(BigInt(150_000));
    expect(applyCoinbaseBatchGasHeadroom(BigInt(500_001))).toBe(BigInt(600_002));
    expect(applyCoinbaseBatchGasHeadroom(BigInt(1_900_000))).toBe(BigInt(2_000_000));
    expect(applyCoinbaseBatchGasHeadroom(BigInt(2_000_000))).toBe(BigInt(2_000_000));
    expect(applyCoinbaseBatchGasHeadroom(BigInt(2_000_001))).toBeNull();
  });

  test("rejects undeployed accounts, malformed calls, and RPC failures", async () => {
    const undeployed = createCoinbaseSmartAccountBatchEstimator({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: (async (_input, init) => {
        const { id } = JSON.parse(String(init?.body)) as { id: number };
        return Response.json({ jsonrpc: "2.0", id, result: "0x" });
      }) as typeof fetch,
    });
    await expect(undeployed.estimateBatch([{ to: ACCOUNT, value: "0", data: "0x" }], ACCOUNT))
      .rejects.toMatchObject({ code: "account-capability" });
    await expect(undeployed.estimateBatch([{ to: "bad" as `0x${string}`, value: "0", data: "0x" }], ACCOUNT))
      .rejects.toBeInstanceOf(TypeError);

    const failed = createCoinbaseSmartAccountBatchEstimator({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch,
    });
    await expect(failed.estimateBatch([{ to: ACCOUNT, value: "0", data: "0x" }], ACCOUNT))
      .rejects.toMatchObject({ code: "rpc", rpcErrorCode: "http", httpStatus: 503 });
  });
});

describe("Coinbase smart-account ordered batch simulation", () => {
  test("simulates the exact ordered calls at the pinned block and reconfirms its hash", async () => {
    const source = sourceFetch();
    const calls = [
      { to: ACCOUNT, value: "0", data: "0x1234" as const },
      { to: IMPLEMENTATION, value: "0", data: "0xabcd" as const },
    ];

    await createCoinbaseSmartAccountBatchSimulator({
      fetchImpl: source.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(calls, ACCOUNT, {
      blockNumber: "100",
      blockHash: BLOCK_HASH,
    });

    expect(source.requests.map(({ method }) => method)).toEqual([
      "eth_getCode",
      "eth_call",
      "eth_getCode",
      "eth_call",
      "eth_getBlockByNumber",
    ]);
    expect(source.requests.every(({ params }) => params.at(-1) === "0x64" || params[0] === "0x64")).toBe(true);
    const batchCall = source.requests[3].params[0] as {
      from: string;
      to: string;
      data: string;
      value: string;
    };
    expect(batchCall).toEqual({
      from: ACCOUNT,
      to: ACCOUNT,
      data: encodeCoinbaseExecuteBatch(calls),
      value: "0x0",
    });
  });

  test("keeps an implementation-probe HTTP rate limit as a typed RPC failure", async () => {
    const requests: number[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      requests.push(request.id);
      if (request.id === 22) {
        return new Response("rate limited", { status: 429 });
      }
      return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x6001" });
    }) as typeof fetch;

    await expect(createCoinbaseSmartAccountBatchSimulator({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(
      [{ to: IMPLEMENTATION, value: "0", data: "0x1234" }],
      ACCOUNT,
      { blockNumber: "100", blockHash: BLOCK_HASH },
    )).rejects.toMatchObject({
      name: "CoinbaseSmartAccountBatchSimulationError",
      code: "rpc",
      rpcErrorCode: "http",
      rpcCode: null,
      httpStatus: 429,
    } satisfies Partial<CoinbaseSmartAccountBatchSimulationError>);
    expect(requests).toEqual([21, 22]);
  });

  test("preserves an executeBatch JSON-RPC error envelope as a typed RPC failure", async () => {
    const source = sourceFetch();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      if (request.id === 24) {
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "execution reverted" },
        });
      }
      return source.fetchImpl(input, init);
    }) as typeof fetch;

    await expect(createCoinbaseSmartAccountBatchSimulator({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(
      [{ to: IMPLEMENTATION, value: "0", data: "0x1234" }],
      ACCOUNT,
      { blockNumber: "100", blockHash: BLOCK_HASH },
    )).rejects.toMatchObject({
      name: "CoinbaseSmartAccountBatchSimulationError",
      code: "rpc",
      rpcErrorCode: "rpc",
      rpcCode: -32000,
      httpStatus: null,
    } satisfies Partial<CoinbaseSmartAccountBatchSimulationError>);
  });

  test("classifies undeployed accounts and implementations as account capability failures", async () => {
    const calls = [{ to: IMPLEMENTATION, value: "0", data: "0x1234" as const }];
    const undeployed = sourceFetch({ accountCode: "0x" });
    const missingImplementation = sourceFetch({ implementationCode: "0x" });

    await expect(createCoinbaseSmartAccountBatchSimulator({
      fetchImpl: undeployed.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(calls, ACCOUNT, {
      blockNumber: "100",
      blockHash: BLOCK_HASH,
    })).rejects.toMatchObject({
      name: "CoinbaseSmartAccountBatchSimulationError",
      code: "account-capability",
    } satisfies Partial<CoinbaseSmartAccountBatchSimulationError>);

    await expect(createCoinbaseSmartAccountBatchSimulator({
      fetchImpl: missingImplementation.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(calls, ACCOUNT, {
      blockNumber: "100",
      blockHash: BLOCK_HASH,
    })).rejects.toMatchObject({ code: "account-capability" });
  });

  test("fails closed when the pinned source block hash changes", async () => {
    const changed = sourceFetch({
      confirmedHash: `0x${"cd".repeat(32)}` as `0x${string}`,
    });

    await expect(createCoinbaseSmartAccountBatchSimulator({
      fetchImpl: changed.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(
      [{ to: IMPLEMENTATION, value: "0", data: "0x1234" }],
      ACCOUNT,
      { blockNumber: "100", blockHash: BLOCK_HASH },
    )).rejects.toMatchObject({
      code: "rpc",
      message: "The Base source block changed during batch simulation.",
    });
  });
});
