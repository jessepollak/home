import { readJson } from "@/tests/helpers/read-json";
import { parseConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import { parseHandleActionErrorResponse, parseHandleActionResponse } from "@/shared/actions/contracts/handle";
import { parseAddress, requireAddress } from "@/shared/chain/hex";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { isRecord } from "@/shared/guards";
import { privateKeyToAccount } from "viem/accounts";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { stockAssets } from "@/config/invest-assets";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { CURRENCY_REGISTRY } from "@/shared/currencies/registry";
import { resolveConvertPair } from "@/shared/currencies/convert";
import { CONVERT_PROVIDER, type ConvertPairRecord } from "@/shared/currencies/types";
import type { ActionRow } from "./store";
import type { TradeMoneyActionMetadata } from "@/shared/trading/contract";
import { createConfirmActionHandler, createDeclineActionHandler, createGetActionHandler, createGetPendingTradeHandler, createHandleActionHandler, createRetryActionHandler } from "./handler";

const events: Array<Record<string, unknown>> = [];
beforeEach(() => {
  events.length = 0;
  setObservabilityLogWriterForTests((line) => {
    const event: unknown = JSON.parse(line);
    if (isRecord(event)) events.push(event);
  });
});
afterEach(() => setObservabilityLogWriterForTests());

const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x3333333333333333333333333333333333333333" as const;
const SIGNER = privateKeyToAccount(`0x${"12".repeat(32)}`);
const HASH = `0x${"ab".repeat(32)}` as const;
const typed = {
  domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: OWNER },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    ],
    CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
  }, primaryType: "CoinbaseSmartWalletMessage", message: { hash: HASH },
} as const;
const feeCall = makePaymasterApproval(BigInt(100_000));
const approval = {
  to: BASE_USDC_ADDRESS, value: "0", approval: { assetId: "usdc", spender: "0x000000000022d473030f116ddee9f6b43ac78ba3" as const },
  data: `0x095ea7b3${"0".repeat(24)}000000000022d473030f116ddee9f6b43ac78ba3${BigInt(1_000_000).toString(16).padStart(64, "0")}` as const,
};
const swap = { to: ROUTER, value: "0", data: "0x1234" as const };
const context = { params: Promise.resolve({ id: ID }) };
function tradeRow(provider: "base-account" | "cdp-embedded", expiresAt: string): ActionRow {
  return {
    id: ID, owner_key: JSON.stringify(["owner", OWNER, 8453, provider]), account_address: OWNER, provider, kind: "trade",
    summary: { title: "Buy Bitcoin", amounts: [], warnings: [], expiresAt,
      networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 } },
    pending: { calls: [feeCall, approval, swap], permitHash: HASH, signingTypedData: typed,
      signerAddress: parseAddress(SIGNER.address)!, signerOwnerIndex: 0, signerDeployed: true, swapCallIndex: 2 },
    created_at: "2026-09-25T12:00:00.000Z", confirmed_at: null, provider_handle: null, transaction_hash: null,
    handle_recorded_at: null, declined_reported_at: null, dispatch_attempt: 0, outcome: null, outcome_source: null,
    settled_at: null, outcome_recorded_at: null,
  };
}
function retryRow(permitDeadline: string, executionDeadline = permitDeadline): ActionRow {
  const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
  row.confirmed_at = "2026-09-25T12:00:00.000Z";
  row.summary.metadata = { product: "trade", permitDeadline, executionDeadline } as TradeMoneyActionMetadata;
  return row;
}
function retryRequest(): Request {
  return new Request(`https://home.test/api/actions/${ID}/retry`, {
    method: "POST", headers: { "X-Home-Account-Provider": "cdp-embedded", "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, attempt: 1 }),
  });
}

function tradeMetadata(address: string, direction: "buy" | "sell"): TradeMoneyActionMetadata {
  const usdc = { id: "usdc", symbol: "USDC", decimals: 6, address: requireAddress(BASE_USDC_ADDRESS) };
  const token = { id: "fixture", symbol: "FIXTURE", decimals: 6, address: requireAddress(address) };
  return {
    product: "trade", provider: "cdp-swaps", direction,
    network: { name: "Base", chainId: 8453 }, assetId: "fixture", assetName: "Fixture",
    fromAsset: direction === "sell" ? token : usdc,
    toAsset: direction === "buy" ? token : usdc,
    fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "1000", minimumToAmountBaseUnits: "990",
    slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "1",
    quotedAt: "2026-09-25T12:00:00.000Z", permitDeadline: "4102444800", executionDeadline: "4102444800",
  };
}

const eurcSellPair: ConvertPairRecord = { id: "eurc-sell", from: "base:eurc", to: "base:usdc", provider: CONVERT_PROVIDER,
  regions: "all", status: "verified", verifiedAt: "2026-09-29", evidence: "test fixture" };
const eurcConvertPair: typeof resolveConvertPair = (input) => resolveConvertPair(
  { ...input, now: new Date("2026-09-30T12:00:00.000Z") },
  { pairs: [eurcSellPair, { ...eurcSellPair, id: "eurc-buy", from: eurcSellPair.to, to: eurcSellPair.from }] });

const request = (signature: string, provider: "base-account" | "cdp-embedded") => new Request(`https://home.test/api/actions/${ID}/confirm`, {
  method: "POST", headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" }, body: JSON.stringify({ signature }),
});

describe("handle response contract", () => {
  function confirmedRow(): ActionRow {
    return { ...tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z"),
      confirmed_at: "2026-09-25T12:01:00.000Z", pending: null, provider_handle: "handle-1", outcome: "succeeded" };
  }

  async function recordHandle(row: ActionRow) {
    let calls = 0;
    const handler = createHandleActionHandler({
      authorize: async () => ({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const }),
      markHot: async () => {},
      store: { recordHandle: async () => { calls += 1; return row; } },
    });
    const response = await handler(new Request(`https://home.test/api/actions/${ID}/handle`, {
      method: "POST", headers: { "X-Home-Account-Provider": "cdp-embedded", "Content-Type": "application/json" },
      body: JSON.stringify({ providerHandle: "handle-1" }),
    }), context);
    return { response, calls };
  }

  test("returns a complete valid presented action", async () => {
    const { response, calls } = await recordHandle(confirmedRow());
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(parseHandleActionResponse(body)).not.toBeNull();
    expect(body).toMatchObject({ version: 1, action: { id: ID, kind: "trade", status: "confirmed" } });
    expect(calls).toBe(1);
  });

  test("fails closed after recording a handle for a malformed stored summary", async () => {
    const row = confirmedRow();
    Object.assign(row.summary, { title: 42 });
    const { response, calls } = await recordHandle(row);
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(parseHandleActionErrorResponse(body)).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(body).not.toHaveProperty("action");
    expect(calls).toBe(1);
  });

  test.each(["missing warnings", "invalid kind", "empty provider", "missing createdAt"])("fails closed for %s", async (failure) => {
    const row = confirmedRow();
    if (failure === "missing warnings") Object.assign(row.summary, { warnings: undefined });
    if (failure === "invalid kind") Object.assign(row, { kind: "invalid" });
    if (failure === "empty provider") Object.assign(row, { provider: "" });
    if (failure === "missing createdAt") row.created_at = "";
    const { response, calls } = await recordHandle(row);
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(parseHandleActionErrorResponse(body)).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(body).not.toHaveProperty("action");
    expect(calls).toBe(1);
  });
});

describe("trade confirmation", () => {
  test.each(["oversized", "content-length", "malformed", "empty", "aborted"])("action mutations reject %s bodies without recording or verifying", async (failure) => {
    const authorize = async () => ({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const });
    let writes = 0;
    const denyWrite = async (): Promise<never> => { writes++; throw new Error("invalid request reached mutation"); };
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const mutations = [
      { path: "confirm", code: "INVALID_TRADE_SIGNATURE", message: "A valid reviewed Permit2 signature is required.", body: { signature: "0x1234" }, handler: createConfirmActionHandler({ authorize, now: () => new Date("2026-09-25T12:01:00.000Z"), readOffering: async () => resolveProductOffering({ kind: "deployment" }), verifySmartAccountSignature: denyWrite, store: { get: async () => row, confirm: denyWrite } }) },
      { path: "handle", code: "INVALID_ACTION_HANDLE", message: "A valid action handle is required.", body: { providerHandle: "handle" }, handler: createHandleActionHandler({ authorize, store: { recordHandle: denyWrite } }) },
      { path: "decline", code: "INVALID_ACTION_DECLINE", message: "A valid versioned decline request is required.", body: { version: 1, attempt: 0 }, handler: createDeclineActionHandler({ authorize, store: { recordDecline: denyWrite } }) },
      { path: "retry", code: "INVALID_ACTION_RETRY", message: "A valid versioned retry request is required.", body: { version: 1, attempt: 1 }, handler: createRetryActionHandler({ authorize, store: { get: denyWrite, beginRetry: denyWrite } }) },
    ];
    for (const mutation of mutations) {
      const body = JSON.stringify(mutation.body);
      const input = new Request(`https://home.test/api/actions/${ID}/${mutation.path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(failure === "content-length" ? { "content-length": String(64 * 1024 + 1) } : {}) },
        signal: failure === "aborted" ? AbortSignal.abort() : undefined,
        body: failure === "oversized" ? " ".repeat(64 * 1024) + body : failure === "malformed" ? "{" : failure === "empty" ? undefined : body,
      });
      const response = await mutation.handler(input, context);
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: { code: mutation.code, message: mutation.message } });
      expect(input.body?.locked ?? false).toBe(false);
    }
    expect(writes).toBe(0);
  });
  test("answers an earlier client's pending-trade check with no blocking trade", async () => {
    const handler = createGetPendingTradeHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
    });
    const result = await handler(new Request("https://home.test/api/actions/trade-pending", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
    expect(result.status).toBe(200);
    expect(await readJson(result)).toEqual({ version: 1, trade: null });
    const signedOut = createGetPendingTradeHandler({ authorize: async () => Response.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await signedOut(new Request("https://home.test/api/actions/trade-pending"))).status).toBe(401);
  });

  test("rejects a legacy trade whose fee recipient is the owner before confirming", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = {
      product: "trade", direction: "buy", assetId: "fixture", fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { address: ROUTER },
      fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "1000", minimumToAmountBaseUnits: "990",
      operatorFee: { amountBaseUnits: "10000", bps: 100, recipient: OWNER, collectedBy: "in-batch-transfer",
        token: { address: BASE_USDC_ADDRESS, decimals: 6, assetId: "usdc", symbol: "USDC" } },
    } as unknown as TradeMoneyActionMetadata;
    let confirms = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(410);
    expect((await result.json()).error.code).toBe("ACTION_EXPIRED");
    expect(events).toContainEqual(expect.objectContaining({ kind: "action-confirm", code: "ACTION_EXPIRED", outcome: "failed" }));
    expect(confirms).toBe(0);
  });

  test.each([
    ["buy", "base:eurc", "pair-paused"],
    ["sell", "base:eurc", "pair-paused"],
    ["buy", "base:eurc", "pair-withdrawn"],
    ["sell", "base:eurc", "pair-withdrawn"],
    ["buy", "base:wars", "pair-missing"],
    ["sell", "base:wars", "pair-missing"],
  ] as const)("rejects a registry currency %s for %s with %s before confirming", async (direction, recordId, reason) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === recordId);
    if (!record) throw new Error(`Missing currency record: ${recordId}`);
    row.summary.metadata = tradeMetadata(record.contractAddress, direction);
    let confirms = 0;
    let verifications = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      ...(reason ? { convertPair: () => ({ status: "unavailable" as const, reason }) } : {}),
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(events).toContainEqual(expect.objectContaining({ kind: "action-confirm", code: "TRADE_ADMISSION_REVOKED", outcome: "failed" }));
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
  });

  test("rejects a currency with no pair through the real Convert resolver before confirming", async () => {
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:wars");
    if (!record) throw new Error("Missing currency record: base:wars");
    expect(resolveConvertPair({ from: "base:usdc", to: record.id }, { pairs: [] })).toEqual({ status: "unavailable", reason: "pair-missing" });
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = tradeMetadata(record.contractAddress, "buy");
    let confirms = 0;
    let verifications = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: (input) => resolveConvertPair(input, { pairs: [] }),
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
  });

  test.each([
    ["removed", "fixture"],
    ["missing", undefined],
    ["non-string", 123],
  ] as const)("rejects a %s buy asset id before confirming", async (_label, assetId) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = tradeMetadata("0x4444444444444444444444444444444444444444", "buy");
    Object.assign(row.summary.metadata, { assetId });
    let confirms = 0;
    let verifications = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      buyBlocked: (id) => id === "fixture",
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
  });

  test.each([
    ["non-removed", "buy", false, 1],
    ["removed-asset", "sell", true, 0],
  ] as const)("confirms a %s %s", async (_label, direction, removed, expectedBuyReads) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = tradeMetadata("0x4444444444444444444444444444444444444444", direction);
    let buyReads = 0;
    let confirms = 0;
    let verifications = 0;
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      readOffering: async () => resolveProductOffering({ kind: "deployment" }),
      buyBlocked: () => { buyReads += 1; return removed; },
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      markHot: async () => {}, recordConfirmed: async () => {},
      store: { get: async () => row, confirm: async (_owner, _id, calls) => {
        if (!row.pending) throw new Error("Missing pending trade");
        if (!calls) throw new Error("Missing confirmed calls");
        confirms += 1;
        return { ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending, calls } };
      } },
    });
    const result = await handler(request(signature, "cdp-embedded"), context);
    expect(result.status).toBe(200);
    expect(confirms).toBe(1);
    expect(verifications).toBe(1);
    expect(buyReads).toBe(expectedBuyReads);
  });

  test.each([
    ["buy", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "base:removed"],
    ["sell", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "base:removed"],
    ["buy", "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", "base:eurc"],
    ["sell", "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", "base:eurc"],
    ["buy", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", null],
    ["sell", "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", null],
  ] as const)("refuses a stored %s identity that no longer names the traded contract", async (direction, address, currencyRecordId) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = { ...tradeMetadata(address, direction), currencyRecordId } as unknown as TradeMoneyActionMetadata;
    let confirms = 0;
    let verifications = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
  });

  test.each(["buy", "sell"] as const)("confirms a matching stored registry identity for %s", async (direction) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:eurc");
    if (!record) throw new Error("Missing currency record: base:eurc");
    row.summary.metadata = { ...tradeMetadata(record.contractAddress, direction), currencyRecordId: record.id };
    const sell: ConvertPairRecord = { id: "eurc-sell", from: record.id, to: "base:usdc", provider: CONVERT_PROVIDER,
      regions: "all", status: "verified", verifiedAt: "2026-09-29", evidence: "test fixture" };
    const buy = { ...sell, id: "eurc-buy", from: sell.to, to: sell.from };
    const convertPair: typeof resolveConvertPair = (input) => resolveConvertPair(
      { ...input, now: new Date("2026-09-30T12:00:00.000Z") }, { pairs: [sell, buy] });
    let verifications = 0;
    let confirms = 0;
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      readOffering: async () => resolveProductOffering({ kind: "deployment" }),
      convertPair,
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      markHot: async () => {}, recordConfirmed: async () => {},
      store: { get: async () => row, confirm: async (_owner, _id, calls) => {
        if (!row.pending) throw new Error("Missing pending trade");
        if (!calls) throw new Error("Missing confirmed calls");
        confirms += 1;
        return { ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending, calls } };
      } },
    });
    const response = await handler(request(signature, "cdp-embedded"), context);
    expect(response.status).toBe(200);
    expect(verifications).toBe(1);
    expect(confirms).toBe(1);
  });

  test("refuses a stored registry identity with a non-string traded asset address before verifying", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:eurc");
    if (!record) throw new Error("Missing currency record: base:eurc");
    row.summary.metadata = { ...tradeMetadata(record.contractAddress, "buy"), currencyRecordId: record.id };
    Object.assign(row.summary.metadata.toAsset, { address: 123 });
    let confirms = 0;
    let verifications = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      verifySmartAccountSignature: async () => { verifications += 1; return true; },
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
  });

  test.each(["buy", "sell"] as const)("keeps a non-registry %s past pair admission", async (direction) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = tradeMetadata("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", direction);
    let pairReads = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: () => { pairReads += 1; return { status: "unavailable", reason: "pair-paused" }; },
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(400);
    expect(await readJson(result)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
    expect(pairReads).toBe(0);
  });

  test.each(["buy", "sell"] as const)("admits a published currency %s to the fee-destination gate", async (direction) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = {
      ...tradeMetadata("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", direction),
      operatorFee: { amountBaseUnits: "10000", bps: 100, recipient: OWNER, collectedBy: "in-batch-transfer",
        token: { address: BASE_USDC_ADDRESS, decimals: 6, assetId: "usdc", symbol: "USDC" } },
    };
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(410);
    expect(await readJson(result)).toMatchObject({ error: { code: "ACTION_EXPIRED", message: "This trade's fee destination is your own account. Prepare the trade again." } });
  });

  test.each([
    [null, { address: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42" }],
    [{ address: BASE_USDC_ADDRESS }, null],
    [[{ address: BASE_USDC_ADDRESS }], { address: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42" }],
    [{ address: 123 }, { address: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42" }],
    [{ address: BASE_USDC_ADDRESS }, { address: 123 }],
  ] as const)("preserves legacy confirmation with asset references %j and %j", async (fromAsset, toAsset) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = { product: "trade", direction: "buy", assetId: "fixture", fromAsset, toAsset } as unknown as TradeMoneyActionMetadata;
    let pairReads = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: () => { pairReads += 1; return { status: "unavailable", reason: "pair-paused" }; },
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(400);
    expect(await readJson(result)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
    expect(pairReads).toBe(0);
  });

  test.each([
    ["missing", "buy", "none"],
    ["invalid", "buy", "none"],
    ["missing", "sell", "none"],
    ["invalid", "sell", "none"],
    ["missing", "buy", "pair-paused"],
    ["invalid", "sell", "pair-paused"],
  ] as const)("resolves the traded side of a %s-direction %s from the non-USDC asset (pause: %s)", async (kind, shape, pause) => {
    const reason = pause === "none" ? null : pause;
    const direction = kind === "invalid" ? "swap" : undefined;
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:eurc");
    if (!record) throw new Error("Missing currency record: base:eurc");
    row.summary.metadata = Object.assign(tradeMetadata(record.contractAddress, shape), { currencyRecordId: record.id, direction });
    const pairs: Array<{ from: string; to: string }> = [];
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: (input) => {
        pairs.push({ from: input.from, to: input.to });
        return reason ? { status: "unavailable", reason } : eurcConvertPair(input);
      },
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(pairs).toContainEqual({ from: "base:usdc", to: record.id });
    expect(pairs.every((pair) => pair.from !== pair.to)).toBe(true);
    if (reason) {
      expect(result.status).toBe(409);
      expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    } else {
      expect(result.status).toBe(400);
      expect(await readJson(result)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
    }
  });

  test.each([
    ["missing", "buy", 409],
    ["invalid", "buy", 409],
    ["missing", "sell", 400],
    ["invalid", "sell", 400],
  ] as const)("applies the Invest entry gate to a %s-direction %s from the non-USDC asset", async (kind, shape, status) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:eurc");
    if (!record) throw new Error("Missing currency record: base:eurc");
    const direction = kind === "invalid" ? "swap" : undefined;
    row.summary.metadata = Object.assign(tradeMetadata(record.contractAddress, shape), { currencyRecordId: record.id, direction });
    let offeringReads = 0;
    let confirms = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: eurcConvertPair,
      readOffering: async () => { offeringReads += 1; return resolveProductOffering({ kind: "unavailable" }); },
      verifySmartAccountSignature: async () => true,
      store: { get: async () => row, confirm: async () => { confirms += 1; throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(status);
    expect(offeringReads).toBe(shape === "buy" ? 1 : 0);
    if (shape === "buy") expect(confirms).toBe(0);
    if (shape === "buy") expect(await readJson(result)).toMatchObject({ error: { code: "PRODUCT_NOT_OFFERED" } });
  });

  test.each(["missing", "invalid"] as const)("keeps a non-registry buy with a %s direction past pair admission", async (kind) => {
    const direction = kind === "invalid" ? "swap" : undefined;
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = Object.assign(tradeMetadata("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "buy"), { direction });
    let pairReads = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: () => { pairReads += 1; return { status: "unavailable", reason: "pair-paused" }; },
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(400);
    expect(await readJson(result)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
    expect(pairReads).toBe(0);
  });

  test.each([
    ["missing", BASE_USDC_ADDRESS, BASE_USDC_ADDRESS],
    ["invalid", BASE_USDC_ADDRESS, BASE_USDC_ADDRESS],
    ["missing", "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"],
    ["invalid", BASE_USDC_ADDRESS, "not-an-address"],
  ] as const)("refuses a %s-direction trade whose pair has no single non-USDC side (%s to %s)", async (kind, fromAddress, toAddress) => {
    const direction = kind === "invalid" ? "swap" : undefined;
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = Object.assign(tradeMetadata("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "buy"),
      { direction, fromAsset: { address: fromAddress }, toAsset: { address: toAddress } });
    let pairReads = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair: (input) => { pairReads += 1; return eurcConvertPair(input); },
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const result = await handler(request("0x1234", "cdp-embedded"), context);
    expect(result.status).toBe(409);
    expect(await readJson(result)).toMatchObject({ error: { code: "TRADE_ADMISSION_REVOKED", message: "This trade is no longer available." } });
    expect(pairReads).toBe(0);
  });

  test.each(["US", null] as const)("blocks a stock buy for %s through the real confirm handler", async (country) => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = { product: "trade", fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { address: stockAssets[0].contractAddress } } as unknown as TradeMoneyActionMetadata;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const restrictedRequest = new Request(`https://home.test/api/actions/${ID}/confirm`, {
      method: "POST", headers: { "X-Home-Account-Provider": "cdp-embedded", ...(country ? { "x-vercel-ip-country": country } : {}) },
      body: JSON.stringify({ signature: "0x1234" }),
    });
    const response = await handler(restrictedRequest, context);
    expect(response.status).toBe(403);
    expect(await readJson(response)).toMatchObject({ error: { code: "TRADE_STOCK_RESTRICTED" } });
  });
  test("allows stock to USDC past the guard in a US request", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.metadata = { product: "trade", fromAsset: { address: stockAssets[0].contractAddress }, toAsset: { address: BASE_USDC_ADDRESS } } as unknown as TradeMoneyActionMetadata;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const response = await handler(request("0x1234", "cdp-embedded"), context);
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
  });
  test.each(["base-account", "cdp-embedded"] as const)("finalizes a fee-prepended %s trade with an exact call commitment", async (provider) => {
    const row = tradeRow(provider, "2026-09-25T12:03:00.000Z");
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    row.summary.metadata = tradeMetadata(OWNER, "buy");
    let offeringReads = 0;
    let committed = "";
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      verifySmartAccountSignature: async ({ smartAccount, permitHash }) => smartAccount === OWNER && permitHash === HASH,
      readOffering: async () => { offeringReads++; return resolveProductOffering({ kind: "deployment" }); },
      estimateBaseBatch: async () => BigInt(100_000), markHot: async () => {}, recordConfirmed: async () => {},
      store: { get: async () => row, confirm: async (_owner, _id, calls) => {
        committed = keccak256(encodeCoinbaseExecuteBatch(calls!));
        return { ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending!, calls: calls! } };
      } },
    });
    const response = await handler(request(signature, provider), context);
    expect(response.status).toBe(200);
    const body = parseConfirmActionResponse(await readJson(response));
    if (!body) throw new Error("Invalid trade confirmation");
    expect(body.calls).toHaveLength(3);
    expect(body.calls[0]).toEqual({
      ...feeCall,
      to: requireAddress(feeCall.to),
      approval: { ...feeCall.approval!, spender: requireAddress(feeCall.approval!.spender) },
    });
    expect(body.calls[1]).toEqual({
      ...approval,
      to: requireAddress(approval.to),
      approval: { ...approval.approval, spender: requireAddress(approval.approval.spender) },
    });
    expect(body.calls[2].data).toStartWith("0x1234");
    expect(body.calls[2].data.length).toBeGreaterThan(swap.data.length);
    expect(committed).toBe(keccak256(encodeCoinbaseExecuteBatch(body.calls)));
    expect(offeringReads).toBe(1);
  });
  test("confirms a stock sell without reading paused invest settings", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const metadata = tradeMetadata(stockAssets[0].contractAddress, "sell");
    row.summary.metadata = { ...metadata, fromAsset: { ...metadata.fromAsset, id: stockAssets[0].id } };
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    let reads = 0;
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), markHot: async () => {}, recordConfirmed: async () => {},
      verifySmartAccountSignature: async () => true,
      readOffering: async () => { reads++; throw new Error("db outage"); },
      store: { get: async () => row, confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending, calls: calls ?? [] } }) },
    });
    expect((await handler(request(signature, "cdp-embedded"), context)).status).toBe(200);
    expect(reads).toBe(0);
  });

  test.each(["base-account", "cdp-embedded"] as const)("finalizes the %s buy swap without changing the preceding operator transfer", async (provider) => {
    const row = tradeRow(provider, "2026-09-25T12:03:00.000Z");
    const recipient = "0x1234567890123456789012345678901234567890" as const;
    const transfer = { to: BASE_USDC_ADDRESS, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, BigInt(10_000)] }) };
    row.pending = { ...row.pending!, calls: [feeCall, transfer, approval, swap], swapCallIndex: 3 };
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), verifySmartAccountSignature: async () => true,
      estimateBaseBatch: async () => BigInt(150_000), markHot: async () => {}, recordConfirmed: async () => {},
      store: { get: async () => row, confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending!, calls: calls! } }) },
    });
    const response = await handler(request(signature, provider), context);
    expect(response.status).toBe(200);
    const body = parseConfirmActionResponse(await readJson(response));
    if (!body) throw new Error("Invalid trade confirmation");
    expect(body.calls).toHaveLength(4);
    expect(body.calls[1]).toEqual({ ...transfer, to: requireAddress(transfer.to) });
    expect(body.calls[3].data).toStartWith(swap.data);
    expect(body.calls[3].data.length).toBeGreaterThan(swap.data.length);
    if (provider === "base-account") expect(body.batchGasLimit).toBeDefined();
  });
  test.each(["base-account", "cdp-embedded"] as const)("finalizes only the middle swap and leaves the %s sell fee transfer unchanged", async (provider) => {
    const row = tradeRow(provider, "2026-09-25T12:03:00.000Z");
    const recipient = "0x1234567890123456789012345678901234567890" as const;
    const transfer = { to: BASE_USDC_ADDRESS, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, BigInt(9)] }) };
    row.pending = { ...row.pending!, calls: [...row.pending!.calls, transfer], swapCallIndex: 2 };
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), verifySmartAccountSignature: async () => true,
      estimateBaseBatch: async () => BigInt(150_000), markHot: async () => {}, recordConfirmed: async () => {},
      store: { get: async () => row, confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending!, calls: calls! } }) },
    });
    const response = await handler(request(signature, provider), context);
    expect(response.status).toBe(200);
    const body = parseConfirmActionResponse(await readJson(response));
    if (!body) throw new Error("Invalid trade confirmation");
    expect(body.calls).toHaveLength(4);
    expect(body.calls[2].data).toStartWith(swap.data);
    expect(body.calls[2].data.length).toBeGreaterThan(swap.data.length);
    expect(body.calls[3]).toEqual({ ...transfer, to: requireAddress(transfer.to) });
    if (provider === "base-account") expect(body.batchGasLimit).toBeUndefined();
  });
  test("confirms a second trade while an earlier dispatched trade has no outcome", async () => {
    const previous = retryRow(String(Date.parse("2026-09-25T12:03:00.000Z") / 1000));
    previous.id = "22222222-2222-4222-8222-222222222222";
    previous.provider_handle = HASH;
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const rows = new Map([[previous.id, previous], [row.id, row]]);
    const confirmedIds: string[] = [];
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), markHot: async () => {}, recordConfirmed: async () => {},
      verifySmartAccountSignature: async () => true,
      store: { get: async (_owner, id) => rows.get(id) ?? null, confirm: async (_owner, id, calls) => {
        confirmedIds.push(id);
        return { ...row, confirmed_at: "2026-09-25T12:01:00.000Z", pending: { ...row.pending!, calls: calls! } };
      } },
    });
    const signature = await SIGNER.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } });
    const result = await handler(request(signature, "cdp-embedded"), context);
    expect(result.status).toBe(200);
    expect(await readJson(result)).toMatchObject({ id: row.id });
    expect(confirmedIds).toEqual([row.id]);
    expect(rows.get(previous.id)?.outcome).toBeNull();
  });
  test("reload returns the verified trade signing request", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.signing = { signer: "cdp-embedded", evmAccount: parseAddress(SIGNER.address)!, typedData: typed };
    const handler = createGetActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      store: { get: async () => row, recordHandle: async () => null, recordOutcome: async () => ({ row: null, written: false, conflict: false }) },
    });
    const result = await handler(new Request(`https://home.test/api/actions/${ID}`, { headers: { "X-Home-Account-Provider": "cdp-embedded" } }), context);
    expect(result.status).toBe(200);
    expect(await readJson(result)).toMatchObject({ kind: "trade", signing: { signer: "cdp-embedded", typedData: typed } });
  });
  test("rejects an unauthorized embedded signer", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    const other = privateKeyToAccount(`0x${"13".repeat(32)}`);
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const response = await handler(request(await other.signTypedData({ ...typed, domain: { ...typed.domain, chainId: BigInt(8453) } }), "cdp-embedded"), context);
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
  });
  test("returns ACTION_EXPIRED before verifying a stale signature", async () => {
    const row = tradeRow("base-account", "2026-09-25T12:00:00.000Z");
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "base-account" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const response = await handler(request("0x1234", "base-account"), context);
    expect(response.status).toBe(410);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
  });
});

describe("confirmed trade replay", () => {
  const finalized = [feeCall, approval, { ...swap, data: `0x1234${"ef".repeat(97)}` as const }];
  function confirmedRow(change?: (row: ActionRow) => void): ActionRow {
    const row = retryRow(String(Date.parse("2026-09-25T12:01:31.000Z") / 1000));
    row.pending = { calls: finalized };
    row.confirmed_call_data_hash = keccak256(encodeCoinbaseExecuteBatch(finalized)).toLowerCase();
    change?.(row);
    return row;
  }
  function replayHandler(row: ActionRow, provider: "base-account" | "cdp-embedded" = "cdp-embedded", convertPair?: typeof resolveConvertPair, buyBlocked?: (assetId: string) => boolean) {
    const effects = { confirms: 0, verifications: 0, recorded: 0, estimates: 0 };
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair, buyBlocked,
      verifySmartAccountSignature: async () => { effects.verifications += 1; return true; },
      estimateBaseBatch: async () => { effects.estimates += 1; return BigInt(100_000); },
      markHot: async () => {}, recordConfirmed: async () => { effects.recorded += 1; },
      store: { get: async () => row, confirm: async () => { effects.confirms += 1; throw new Error("Must not confirm"); } },
    });
    return { effects, confirm: (provider: "base-account" | "cdp-embedded") => handler(new Request(`https://home.test/api/actions/${ID}/confirm`, {
      method: "POST", headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" }, body: "{}",
    }), context) };
  }

  test("blocks a signed stock-buy replay if country is missing", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = { ...value.summary.metadata, fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { address: stockAssets[0].contractAddress } } as unknown as TradeMoneyActionMetadata;
    });
    const { effects, confirm } = replayHandler(row);
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(403);
    expect(await readJson(response)).toMatchObject({ error: { code: "TRADE_STOCK_RESTRICTED" } });
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });

  test.each(["base-account", "cdp-embedded"] as const)("returns the committed %s plan without re-finalizing", async (provider) => {
    const row = confirmedRow((value) => { value.provider = provider; value.owner_key = JSON.stringify(["owner", OWNER, 8453, provider]); });
    const { effects, confirm } = replayHandler(row, provider);
    const response = await confirm(provider);
    expect(response.status).toBe(200);
    const body = parseConfirmActionResponse(await readJson(response));
    if (!body) throw new Error("Invalid trade confirmation");
    expect(body.calls).toEqual(finalized.map((call) => ({
      ...call,
      to: call.to.toLowerCase() as `0x${string}`,
      ...(call.approval ? { approval: { ...call.approval, spender: call.approval.spender.toLowerCase() as `0x${string}` } } : {}),
    })));
    expect(Boolean(body.batchGasLimit)).toBe(provider === "base-account");
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: provider === "base-account" ? 1 : 0 });
  });

  test("replays a committed buy after operator removal without reading buy policy", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = tradeMetadata("0x4444444444444444444444444444444444444444", "buy");
    });
    let buyReads = 0;
    const { effects, confirm } = replayHandler(row, "cdp-embedded", undefined, () => {
      buyReads += 1;
      return true;
    });
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ calls: finalized });
    expect(buyReads).toBe(0);
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });

  test.each(["buy", "sell"] as const)("replays a committed currency %s after its registry record is removed", async (direction) => {
    const row = confirmedRow((value) => {
      value.summary.metadata = {
        ...value.summary.metadata,
        ...tradeMetadata("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", direction),
        currencyRecordId: "base:removed",
      };
    });
    let pairReads = 0;
    const { effects, confirm } = replayHandler(row, "cdp-embedded", () => {
      pairReads += 1;
      return { status: "unavailable", reason: "asset-unknown" };
    });
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ calls: finalized });
    expect(pairReads).toBe(0);
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });

  test.each(["buy", "sell"] as const)("replays a committed currency %s after pair admission is paused", async (direction) => {
    const row = confirmedRow((value) => {
      value.summary.metadata = {
        ...value.summary.metadata,
        ...tradeMetadata("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", direction),
      };
    });
    let pairReads = 0;
    const { effects, confirm } = replayHandler(row, "cdp-embedded", () => {
      pairReads += 1;
      return { status: "unavailable", reason: "pair-paused" };
    });
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ calls: finalized });
    expect(pairReads).toBe(0);
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });

  test.each([
    ["a provider handle", (row: ActionRow) => { row.provider_handle = HASH; }],
    ["a transaction hash", (row: ActionRow) => { row.transaction_hash = HASH; }],
    ["an outcome", (row: ActionRow) => { row.outcome = "not_submitted"; }],
    ["a reported decline", (row: ActionRow) => { row.declined_reported_at = "2026-09-25T12:00:30.000Z"; }],
    ["a later dispatch attempt", (row: ActionRow) => { row.dispatch_attempt = 1; }],
    ["a mismatched commitment", (row: ActionRow) => { row.confirmed_call_data_hash = HASH; }],
    ["no stored plan", (row: ActionRow) => { row.pending = null; }],
    ["a non-trade kind", (row: ActionRow) => { row.kind = "send"; }],
  ] as const)("refuses replay after %s", async (_label, change) => {
    const { effects, confirm } = replayHandler(confirmedRow(change));
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(404);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_NOT_FOUND" } });
    expect(effects.confirms).toBe(0);
  });

  test("refuses replay after the maker deadline even when the taker permit remains valid", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = retryRow(String(Date.parse("2026-09-25T12:03:00.000Z") / 1000), String(Date.parse("2026-09-25T12:00:59.000Z") / 1000)).summary.metadata;
    });
    const { effects, confirm } = replayHandler(row);
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });
  test.each([undefined, "invalid", String(Date.parse("2026-09-25T12:04:00.000Z") / 1000)])("refuses replay with an invalid execution deadline %s", async (deadline) => {
    const row = confirmedRow((value) => {
      value.summary.metadata = { product: "trade", permitDeadline: String(Date.parse("2026-09-25T12:03:00.000Z") / 1000), executionDeadline: deadline } as TradeMoneyActionMetadata;
    });
    const response = await replayHandler(row).confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
  });
  test("refuses replay within 30 seconds of the permit deadline", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = { product: "trade", permitDeadline: String(Date.parse("2026-09-25T12:01:30.000Z") / 1000), executionDeadline: String(Date.parse("2026-09-25T12:01:30.000Z") / 1000) } as TradeMoneyActionMetadata;
    });
    const response = await replayHandler(row).confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
    expect(events).toContainEqual(expect.objectContaining({ kind: "action-confirm", code: "ACTION_EXPIRED", outcome: "failed" }));
  });
});

describe("trade retry deadline", () => {
  test.each([
    ["past", "2026-09-25T12:00:59.000Z"],
    ["within 30 seconds", "2026-09-25T12:01:29.000Z"],
    ["exactly 30 seconds", "2026-09-25T12:01:30.000Z"],
  ])("refuses %s Permit2 deadline before beginRetry", async (_label, deadline) => {
    const row = retryRow(String(Date.parse(deadline) / 1000));
    let retries = 0;
    const handler = createRetryActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, beginRetry: async () => { retries += 1; throw new Error("Must not retry"); } },
    });
    const response = await handler(retryRequest(), context);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({ error: { code: "ACTION_EXPIRED", message: "The trade quote expired. Get a new quote." } });
    expect(retries).toBe(0);
  });
  test("refuses retry after the maker deadline even when the taker permit remains valid", async () => {
    const row = retryRow(String(Date.parse("2026-09-25T12:03:00.000Z") / 1000), String(Date.parse("2026-09-25T12:00:59.000Z") / 1000));
    let retries = 0;
    const handler = createRetryActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, beginRetry: async () => { retries += 1; throw new Error("Must not retry"); } },
    });
    const response = await handler(retryRequest(), context);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
    expect(retries).toBe(0);
  });
  test.each([undefined, "invalid", String(Date.parse("2026-09-25T12:04:00.000Z") / 1000)])("refuses retry with an invalid execution deadline %s", async (deadline) => {
    const row = retryRow(String(Date.parse("2026-09-25T12:03:00.000Z") / 1000));
    row.summary.metadata = { ...row.summary.metadata, executionDeadline: deadline } as TradeMoneyActionMetadata;
    let retries = 0;
    const handler = createRetryActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, beginRetry: async () => { retries += 1; throw new Error("Must not retry"); } },
    });
    const response = await handler(retryRequest(), context);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
    expect(retries).toBe(0);
  });
  test.each(["trade", "send"] as const)("allows an unexpired %s retry", async (kind) => {
    const row = retryRow(String(Date.parse("2026-09-25T12:01:31.000Z") / 1000));
    if (kind === "send") { row.kind = "send"; row.summary.metadata = undefined; }
    let retries = 0;
    const handler = createRetryActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      store: { get: async () => row, beginRetry: async () => { retries += 1; return { row, conflict: false, dispatched: false }; } },
    });
    const response = await handler(retryRequest(), context);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ action: { id: ID } });
    expect(retries).toBe(1);
  });
});
