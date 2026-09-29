import { afterEach, describe, expect, jest, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, parseAbi, parseAbiParameters } from "viem";
import type { Address } from "@/shared/trading/server-types";
import { CdpSwapsRefusalError, CdpSwapsUnavailableError, createCdpSwapsClient, type CdpSwapsClient, type SwapQuote } from "./cdp-swaps";
import { checkpointExitCode, runSwapsCheckpoint } from "./checkpoint";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import { swapTokens } from "./quote";

const TOKEN = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Address;
const TAKER = "0x1111111111111111111111111111111111111111" as Address;
const TARGET = "0x3333333333333333333333333333333333333333" as Address;
const NOW = new Date("2026-09-24T12:00:00.000Z");
const SETTLER_ABI = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage, bytes[] actions, bytes32 zid)"]);
function settlerData(toToken: Address, direction: "buy" | "sell") {
  const fromToken = swapTokens(direction, TOKEN).fromToken;
  const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
  return `0x1fff991f${word(BigInt(TAKER))}${word(BigInt(toToken))}${word(990)}${word(0xa0)}${word(0)}${word(2)}${word(128)}${word(64)}${word(4)}aabbccdd${"0".repeat(56)}${word(0xffff)}c1fb425e${word(BigInt(TARGET))}${word(BigInt(fromToken))}${word(direction === "buy" ? 1_000_000 : 1000)}${word(4)}${word(Math.floor(NOW.getTime() / 1000) + 900)}${word(0xc0)}` as `0x${string}`;
}
function v3SettlerData(toToken: Address, direction: "buy" | "sell", ppm: bigint) {
  const fromToken = swapTokens(direction, TOKEN).fromToken;
  const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
  const path = `${fromToken}00000000${"00".repeat(20)}${toToken.slice(2)}` as `0x${string}`;
  const v3 = `8d68a156${encodeAbiParameters(parseAbiParameters("address recipient, uint256 ppm, bytes path, uint256 amountOutMin"), [TARGET, ppm, path, BigInt(0)]).slice(2)}`;
  const bytes = v3.length / 2;
  const padded = `${word(bytes)}${v3}${"0".repeat((32 - bytes % 32) % 32 * 2)}`;
  const transfer = settlerData(toToken, direction).split(word(0xffff))[1];
  return `0x1fff991f${word(BigInt(TAKER))}${word(BigInt(toToken))}${word(990)}${word(0xa0)}${word(0)}${word(2)}${word(64 + padded.length / 2)}${word(64)}${padded}${word(0xffff)}${transfer}` as `0x${string}`;
}
afterEach(() => jest.useRealTimers());
const request = { ...swapTokens("buy", TOKEN), fromAmount: BigInt(1_000_000), taker: TAKER, slippageBps: 100 };
function rawQuote(direction: "buy" | "sell" = "buy", balance = false) {
  const { fromToken, toToken } = swapTokens(direction, TOKEN);
  const fromAmount = direction === "buy" ? "1000000" : "1000";
  const eip712 = {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom" as const,
    message: { permitted: { token: fromToken, amount: fromAmount }, spender: TARGET, nonce: "4", deadline: String(Math.floor(NOW.getTime() / 1000) + 900) },
  };
  return {
    liquidityAvailable: true, fromToken, toToken, fromAmount, toAmount: "1000", minToAmount: "990", blockNumber: "1000",
    fees: { gasFee: { token: fromToken, amount: "1" }, protocolFee: null },
    issues: { allowance: null, balance: balance ? { token: fromToken, currentBalance: "0", requiredBalance: fromAmount } : null, simulationIncomplete: balance },
    permit2: { hash: hashTypedData(eip712 as Parameters<typeof hashTypedData>[0]), eip712 },
    transaction: { to: TARGET, data: settlerData(toToken, direction), value: "0", gas: "100", gasPrice: "2" },
  };
}
const env = { CDP_API_KEY_ID: "test-id", CDP_API_KEY_SECRET: "test-secret" };
const jwt = (async () => "sensitive-jwt") as NonNullable<Parameters<typeof createCdpSwapsClient>[0]>["generateJwtImpl"];

describe("CDP Swaps client", () => {
  test("turns the exact provider refusal into a sanitized not-routed failure", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async () => Response.json({ errorType: "invalid_request", errorMessage: "The token you're trying to buy isn't authorized for this swap." }, { status: 400 })) as unknown as typeof fetch,
    });
    try {
      await client.createQuote(request);
      throw new Error("Expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(TradePreparationError);
      expect((error as TradePreparationError).reason).toBe("token-not-routed");
      expect((error as Error).message).not.toContain("authorized for this swap");
    }
  });
  test("uses signed exact paths, query/body and unique POST keys without leaking them to GET", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const signed: unknown[] = [];
    const client = createCdpSwapsClient({ env,
      generateJwtImpl: (async (params: unknown) => { signed.push(params); return "sensitive-jwt"; }) as typeof jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        return Response.json(calls.length === 1 ? { ...rawQuote(), gas: null, gasPrice: "2" } : rawQuote());
      }) as unknown as typeof fetch,
    });
    const price = await client.getPrice(request);
    const quote = await client.createQuote(request);
    await client.createQuote(request);
    expect(price.liquidityAvailable).toBe(true);
    expect(quote.liquidityAvailable && quote.fromAmount).toBe(BigInt(1_000_000));
    expect(signed).toEqual(["GET", "POST", "POST"].map((method) => ({
      apiKeyId: "test-id", apiKeySecret: "test-secret", requestMethod: method,
      requestHost: "api.cdp.coinbase.com", requestPath: method === "GET" ? "/platform/v2/evm/swaps/quote" : "/platform/v2/evm/swaps", expiresIn: 120,
    })));
    const get = new URL(calls[0].url);
    expect(`${get.origin}${get.pathname}`).toBe(`https://api.cdp.coinbase.com/platform/v2/evm/swaps/quote`);
    expect(Object.fromEntries(get.searchParams)).toEqual({ network: "base", fromToken: request.fromToken, toToken: request.toToken, fromAmount: "1000000", taker: TAKER, slippageBps: "100" });
    expect(calls[0].init.body).toBeUndefined();
    expect(new Headers(calls[0].init.headers).has("X-Idempotency-Key")).toBe(false);
    expect(calls.slice(1).map((c) => c.url)).toEqual([`https://api.cdp.coinbase.com/platform/v2/evm/swaps`, `https://api.cdp.coinbase.com/platform/v2/evm/swaps`]);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ network: "base", fromToken: request.fromToken, toToken: request.toToken, fromAmount: "1000000", taker: TAKER, slippageBps: 100 });
    expect(calls.every((c) => c.init.cache === "no-store" && new Headers(c.init.headers).get("Authorization") === "Bearer sensitive-jwt")).toBe(true);
    const keys = calls.slice(1).map((c) => new Headers(c.init.headers).get("X-Idempotency-Key"));
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => !!key && key.length === 36)).toBe(true);
  });
  test("refuses unsupported provider-native fees before making a provider request", async () => {
    let requested = false;
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async () => { requested = true; throw new Error("should not be called"); }) as unknown as typeof fetch,
    });
    await expect(client.createQuote({ ...request, operatorFee: { bps: 100, recipient: TAKER } }))
      .rejects.toBeInstanceOf(CdpSwapsUnavailableError);
    expect(requested).toBe(false);
  });
  test("rejects missing credentials", () => {
    expect(() => createCdpSwapsClient({ env: { CDP_API_KEY_ID: " ", CDP_API_KEY_SECRET: " " } })).toThrow("CDP Swaps unavailable.");
  });
  test("uses caller key once and never reuses it", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt, fetchImpl: (async () => Response.json(rawQuote())) as unknown as unknown as typeof fetch });
    const keyed = { ...request, requestKey: "00000000-0000-4000-8000-000000000001" };
    await client.createQuote(keyed);
    await expect(client.createQuote(keyed)).rejects.toThrow("CDP Swaps unavailable.");
  });
  test.each([
    ["upstream error", () => new Response("private-provider-body", { status: 503 })],
    ["bad json", () => new Response("private-provider-body")],
    ["bad schema", () => Response.json({ ...rawQuote(), fromAmount: "-1" })],
    ["bad hex", () => Response.json({ ...rawQuote(), transaction: { ...rawQuote().transaction, data: "0xabc" } })],
    ["bad hash", () => Response.json({ ...rawQuote(), permit2: { ...rawQuote().permit2, hash: "0xaabb" } })],
    ["bad fee token", () => Response.json({ ...rawQuote(), fees: { gasFee: { token: "0xabc", amount: "1" }, protocolFee: null } })],
    ["missing simulation flag", () => Response.json({ ...rawQuote(), issues: { allowance: null, balance: null } })],
    ["oversized integer", () => Response.json({ ...rawQuote(), blockNumber: String(BigInt(2) ** BigInt(256)) })],
  ])("fails closed on %s without body or credentials", async (_label, response) => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt, fetchImpl: (async () => response()) as unknown as unknown as typeof fetch });
    try { await client.createQuote(request); throw new Error("Expected rejection"); }
    catch (error) {
      expect(String(error)).toBe("CdpSwapsUnavailableError: CDP Swaps unavailable.");
      expect(JSON.stringify(error)).not.toContain("private-provider-body");
      expect(JSON.stringify(error)).not.toContain("test-secret");
    }
  });
  test("abort timeout closes the request without a real sleep", async () => {
    jest.useFakeTimers();
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt, timeoutMs: 1,
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        fetchStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("private-timeout")));
        });
      }) as unknown as typeof fetch,
    });
    const pending = client.getPrice(request);
    await started;
    void jest.advanceTimersByTime(1);
    await expect(pending).rejects.toThrow("CDP Swaps unavailable.");
  });
  test("liquidity false is a valid result", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt, fetchImpl: (async () => Response.json({ liquidityAvailable: false })) as unknown as unknown as typeof fetch });
    expect(await client.getPrice(request)).toEqual({ liquidityAvailable: false });
    expect(await client.createQuote(request)).toEqual({ liquidityAvailable: false });
  });
});

describe("sanitized operator checkpoint", () => {
  test("does not report an RFQ action verified when its maker signature fails at the pinned block", async () => {
    const row = rawQuote("buy");
    const maker = "0x7777777777777777777777777777777777777777" as Address;
    const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
    const rfq = `d92aadfb${encodeAbiParameters(
      parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount"),
      [TARGET, { permitted: { token: row.toToken, amount: BigInt(1000) }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, maker, "0x1234", row.fromToken, BigInt(1_000_000)],
    ).slice(2)}`;
    const length = rfq.length / 2;
    const paddedRfq = `${word(length)}${rfq}${"0".repeat((32 - length % 32) % 32 * 2)}`;
    row.transaction.data = `0x1fff991f${word(BigInt(TAKER))}${word(BigInt(row.toToken))}${word(990)}${word(0xa0)}${word(0)}${word(2)}${word(64 + paddedRfq.length / 2)}${word(64)}${paddedRfq}${word(0xffff)}${settlerData(row.toToken, "buy").split(word(0xffff))[1]}` as `0x${string}`;
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => Response.json(init?.method === "GET" ? { ...row, gas: null, gasPrice: "2" } : row)) as typeof fetch,
    });
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW,
      readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => TARGET,
      read: async (method, params) => {
        expect([method, params]).toEqual(["eth_getCode", [maker, "0x3e8"]]);
        return "0x";
      },
    });
    expect(report.directions[0]).toMatchObject({ actionSelectors: ["0xc1fb425e", "0xd92aadfb"], inputSpend: "exact", actionsVerified: false,
      quoteCompatible: true, executionReadiness: "unverified-actions" });
  });
  test("reports both directions without execution secrets; unfunded does not mask permit compatibility", async () => {
    const rows = [rawQuote("buy", true), rawQuote("sell")];
    let index = 0;
    const client: CdpSwapsClient = {
      getPrice: async () => ({ liquidityAvailable: false }),
      createQuote: async () => {
        const q = rows[index++];
        return { ...q, fromAmount: BigInt(q.fromAmount), toAmount: BigInt(q.toAmount), minToAmount: BigInt(q.minToAmount), blockNumber: BigInt(q.blockNumber),
          fees: { gasFee: { token: q.fromToken, amount: BigInt(1) }, protocolFee: null },
          issues: { allowance: null, balance: q.issues.balance && { token: q.fromToken, currentBalance: BigInt(0), requiredBalance: BigInt(q.fromAmount) }, simulationIncomplete: q.issues.simulationIncomplete },
          permit2: q.permit2, transaction: { to: TARGET, data: q.transaction.data, value: BigInt(0), gas: BigInt(100), gasPrice: BigInt(2) },
        } as SwapQuote;
      },
    };
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW, readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => TARGET });
    const serialized = JSON.stringify(report);
    expect(report.schema).toBe("CDP OpenAPI 2.0.0 / @coinbase/cdp-sdk 1.55.0");
    expect(report.directions.map((d) => d.executionReadiness)).toEqual(["insufficient-balance", "unverified-actions"]);
    expect(report.directions.map((d) => d.permit2Compatible)).toEqual([true, true]);
    expect(report.directions.map((d) => [d.targetMatchesRouter, d.calldataMatches])).toEqual([[true, true], [true, true]]);
    expect(report.directions.map((d) => [d.actionSelectors, d.actionsVerified])).toEqual([[["0xc1fb425e", "0xaabbccdd"], false], [["0xc1fb425e", "0xaabbccdd"], false]]);
    expect(checkpointExitCode(report)).toBe(2);
    for (const secret of [rows[0].transaction.data, rows[0].permit2.hash, TAKER, "sensitive-jwt", "\"nonce\""]) expect(serialized).not.toContain(secret);
  });
  test("classifies two compatible and liquid directions as exit zero even when one is unfunded", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const fromToken = init?.method === "GET" ? new URL(String(url)).searchParams.get("fromToken") : (JSON.parse(String(init?.body)) as { fromToken: string }).fromToken;
        const direction = fromToken === swapTokens("sell", TOKEN).fromToken ? "sell" : "buy";
        const row = rawQuote(direction, direction === "buy");
        return Response.json(init?.method === "GET" ? { ...row, gas: null, gasPrice: "2" } : row);
      }) as unknown as typeof fetch,
    });
    let routerReads = 0;
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW, readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => { routerReads++; return TARGET; } });
    expect(routerReads).toBe(1);
    expect(report.directions.map((row) => row.executionReadiness)).toEqual(["insufficient-balance", "unverified-actions"]);
    expect(report.directions.map((row) => [row.targetMatchesRouter, row.calldataMatches])).toEqual([[true, true], [true, true]]);
    expect(report.directions.map((row) => [row.actionSelectors, row.actionsVerified])).toEqual([[["0xc1fb425e", "0xaabbccdd"], false], [["0xc1fb425e", "0xaabbccdd"], false]]);
    expect(checkpointExitCode(report)).toBe(2);
  });
  test.each([
    [BigInt(1_000_000), "exact", true, "ready", 0],
    [BigInt(999_999), "underfill", false, "stale-quote", 2],
  ] as const)("reports %s input spend for a funded V3 route", async (ppm, spend, verified, readiness, exitCode) => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const fromToken = init?.method === "GET" ? new URL(String(url)).searchParams.get("fromToken") : (JSON.parse(String(init?.body)) as { fromToken: string }).fromToken;
        const direction = fromToken === swapTokens("sell", TOKEN).fromToken ? "sell" : "buy";
        const row = rawQuote(direction);
        row.transaction.data = v3SettlerData(row.toToken, direction, direction === "buy" ? ppm : BigInt(1_000_000));
        return Response.json(init?.method === "GET" ? { ...row, gas: null, gasPrice: "2" } : row);
      }) as unknown as typeof fetch,
    });
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW,
      readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => TARGET,
    });
    expect(report.directions[0]).toMatchObject({ chain: "available", actionSelectors: ["0xc1fb425e", "0x8d68a156"],
      inputSpend: spend, actionsVerified: verified, executionReadiness: readiness });
    expect(report.directions[1]).toMatchObject({ inputSpend: "exact", actionsVerified: true, executionReadiness: "ready" });
    expect(JSON.parse(JSON.stringify(report)).directions[0].inputSpend).toBe(spend);
    expect(checkpointExitCode(report)).toBe(exitCode);
  });
  test("checks each liquid quote against the block read after that direction's quote", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const fromToken = init?.method === "GET" ? new URL(String(url)).searchParams.get("fromToken") : (JSON.parse(String(init?.body)) as { fromToken: string }).fromToken;
        const direction = fromToken === swapTokens("sell", TOKEN).fromToken ? "sell" : "buy";
        const row = rawQuote(direction);
        return Response.json(init?.method === "GET" ? { ...row, gas: null, gasPrice: "2" } : { ...row, blockNumber: direction === "sell" ? "1010" : "1000" });
      }) as unknown as typeof fetch,
    });
    let blockReads = 0;
    let routerReads = 0;
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW,
      readBlockNumber: async () => BigInt(1000 + blockReads++ * 10), readSwapRouter: async () => { routerReads++; return TARGET; },
    });
    expect(blockReads).toBe(2);
    expect(routerReads).toBe(1);
    expect(report.directions.map((row) => [row.quoteCompatible, row.compatibilityReason])).toEqual([[true, null], [true, null]]);
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("reports a failed block read for only that direction as provider-unavailable", async () => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const fromToken = init?.method === "GET" ? new URL(String(url)).searchParams.get("fromToken") : (JSON.parse(String(init?.body)) as { fromToken: string }).fromToken;
        const direction = fromToken === swapTokens("sell", TOKEN).fromToken ? "sell" : "buy";
        const row = rawQuote(direction);
        return Response.json(init?.method === "GET" ? { ...row, gas: null, gasPrice: "2" } : row);
      }) as unknown as typeof fetch,
    });
    let blockReads = 0;
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW,
      readBlockNumber: async () => { if (++blockReads === 2) throw new Error("block provider failed"); return BigInt(1000); }, readSwapRouter: async () => TARGET,
    });
    expect(blockReads).toBe(2);
    expect(report.directions.map((row) => [row.quoteCompatible, row.compatibilityReason, row.executionReadiness])).toEqual([
      [true, null, "unverified-actions"], [false, "chain-unavailable", "chain-unavailable"],
    ]);
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("reports no action selectors when quotes have no liquidity", async () => {
    const client: CdpSwapsClient = {
      getPrice: async () => ({ liquidityAvailable: false }),
      createQuote: async () => ({ liquidityAvailable: false }),
    };
    let blockReads = 0;
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW, readBlockNumber: async () => { blockReads++; return BigInt(1000); }, readSwapRouter: async () => TARGET });
    expect(blockReads).toBe(0);
    expect(report.directions.map((row) => [row.actionSelectors, row.actionsVerified, row.inputSpend])).toEqual([[null, false, null], [null, false, null]]);
    expect(checkpointExitCode(report)).toBe(2);
  });
  type RawQuote = ReturnType<typeof rawQuote>;
  const defects: Array<[string, (row: RawQuote) => unknown, boolean, null | undefined]> = [
    ["wrong allowance spender", (row) => ({ ...row, issues: { ...row.issues, allowance: { spender: TAKER, currentAllowance: "0" } } }), true, undefined],
    ["nonzero value", (row) => ({ ...row, transaction: { ...row.transaction, value: "1" } }), true, undefined],
    ["forbidden target", (row) => ({ ...row, transaction: { ...row.transaction, to: PERMIT2_ADDRESS } }), true, null],
    ["empty calldata", (row) => ({ ...row, transaction: { ...row.transaction, data: "0x" } }), true, null],
    ["short action", (row) => ({ ...row, transaction: { ...row.transaction, data: encodeFunctionData({ abi: SETTLER_ABI, args: [
      { recipient: TAKER, buyToken: row.toToken, minAmountOut: BigInt(990) }, ["0xaabb"], `0x${"00".repeat(32)}`,
    ] }) } }), true, null],
    ["trailing calldata", (row) => ({ ...row, transaction: { ...row.transaction, data: `${row.transaction.data}00` } }), true, null],
    ["gas ceiling", (row) => ({ ...row, transaction: { ...row.transaction, gas: "3000001" } }), true, undefined],
    ["stale block", (row) => ({ ...row, blockNumber: "900" }), true, undefined],
    ["slippage floor", (row) => ({ ...row, minToAmount: "1" }), true, undefined],
    ["funded simulation incomplete", (row) => ({ ...row, issues: { ...row.issues, simulationIncomplete: true } }), false, undefined],
  ];
  test.each(defects)("exits non-zero for %s even when liquidity and permit are valid", async (_label, mutate, unfunded, expectedSpend) => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const fromToken = init?.method === "GET" ? new URL(String(url)).searchParams.get("fromToken") : (JSON.parse(String(init?.body)) as { fromToken: string }).fromToken;
        const direction = fromToken === swapTokens("sell", TOKEN).fromToken ? "sell" : "buy";
        const row = rawQuote(direction, unfunded && direction === "buy");
        if (init?.method === "GET") return Response.json({ ...row, gas: null, gasPrice: "2" });
        return Response.json(direction === "buy" ? mutate(row) : row);
      }) as unknown as typeof fetch,
    });
    const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW, readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => TARGET });
    const buy = report.directions[0];
    expect(buy.priceLiquidityAvailable && buy.quoteLiquidityAvailable).toBe(true);
    expect(buy.executionReadiness === "ready").toBe(false);
    if (_label === "forbidden target") expect(buy.targetMatchesRouter).toBe(false);
    if (_label === "empty calldata" || _label === "trailing calldata" || _label === "short action") expect(buy.calldataMatches).toBe(false);
    if (_label === "short action" || _label === "empty calldata") expect([buy.actionSelectors, buy.actionsVerified]).toEqual([null, false]);
    if (expectedSpend !== undefined) expect(buy.inputSpend).toBe(expectedSpend);
    expect(checkpointExitCode(report)).toBe(2);
  });
});

describe("provider refusal classification", () => {
  test.each([
    [400, { errorType: "amount_below_minimum", errorMessage: "Amount too small" }, "below-minimum"],
    [422, { errorType: "invalid_request", errorMessage: "minimum amount is 0.1" }, "below-minimum"],
    [404, { errorType: "no_route", errorMessage: "No route" }, "route-unavailable"],
    [400, { errorType: "invalid_request", errorMessage: "One or more swap parameters are invalid. Check the token addresses, amount, and network, then try again." }, "route-unavailable"],
    [400, { errorType: "invalid_request", errorMessage: "address does not match regex" }, "route-unavailable"],
  ] as const)("classifies HTTP %i with CDP body as %s", async (status, body, reason) => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async () => Response.json(body, { status })) as unknown as typeof fetch });
    const error = await client.createQuote(request).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CdpSwapsRefusalError);
    if (!(error instanceof CdpSwapsRefusalError)) throw error;
    expect(error.reason).toBe(reason);
    expect(error.message).not.toContain(body.errorMessage);
  });
  test.each([429, 500, 401, 403, 200])("HTTP %i or malformed body is an outage", async (status) => {
    const client = createCdpSwapsClient({ env, generateJwtImpl: jwt,
      fetchImpl: (async () => Response.json({ errorType: "invalid_request", errorMessage: "bad" }, { status })) as unknown as typeof fetch });
    await expect(client.createQuote(request)).rejects.toBeInstanceOf(CdpSwapsUnavailableError);
  });
});

test("checkpoint keeps provider evidence when the chain registry is unavailable", async () => {
  const quote = rawQuote();
  const client: CdpSwapsClient = {
    getPrice: async () => ({ liquidityAvailable: false }),
    createQuote: async () => ({ ...quote, fromAmount: BigInt(1_000_000), toAmount: BigInt(1000), minToAmount: BigInt(990), blockNumber: BigInt(1000),
      fees: { gasFee: null, protocolFee: null }, issues: { allowance: null, balance: null, simulationIncomplete: false },
      permit2: null, transaction: { to: TARGET, data: quote.transaction.data, value: BigInt(0), gas: BigInt(100), gasPrice: BigInt(1) },
      fromToken: request.fromToken, toToken: request.toToken }),
  };
  const report = await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1_000_000) }, now: NOW,
    readSwapRouter: async () => { throw new Error("registry unavailable"); }, readBlockNumber: async () => { throw new Error("block unavailable"); } });
  expect(report.directions[0]).toMatchObject({ quoteLiquidityAvailable: true, chain: "unavailable", actionsVerified: null, inputSpend: null,
    actionSelectors: ["0xc1fb425e", "0xaabbccdd"], executionReadiness: "chain-unavailable" });
  expect(checkpointExitCode(report)).toBe(2);
});

test("checkpoint sweep sells the buy executable quote's expected amount", async () => {
  const requests: bigint[] = [];
  const client: CdpSwapsClient = {
    getPrice: async () => ({ liquidityAvailable: false }),
    createQuote: async (trade) => {
      requests.push(trade.fromAmount);
      return trade.fromToken === request.fromToken ? { liquidityAvailable: true, fromToken: trade.fromToken, toToken: trade.toToken, fromAmount: trade.fromAmount, toAmount: BigInt(250), minToAmount: BigInt(240), blockNumber: BigInt(1000), fees: { gasFee: null, protocolFee: null }, issues: { allowance: null, balance: null, simulationIncomplete: false }, permit2: null, transaction: { to: TARGET, data: "0x", value: BigInt(0), gas: BigInt(1), gasPrice: BigInt(1) } } : { liquidityAvailable: false };
    },
  };
  await runSwapsCheckpoint({ client, taker: TAKER, amounts: { buy: BigInt(100_000), sell: BigInt(1) }, now: NOW,
    deriveSellFromBuy: true, readSwapRouter: async () => TARGET, readBlockNumber: async () => BigInt(1000) });
  expect(requests).toEqual([BigInt(100_000), BigInt(250)]);
});
