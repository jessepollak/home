import { readJson } from "@/tests/helpers/read-json";
import { parseConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import { parseAddress, requireAddress } from "@/shared/chain/hex";
import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { stockAssets } from "@/config/invest-assets";
import { CURRENCY_REGISTRY } from "@/shared/currencies/registry";
import type { resolveConvertPair } from "@/shared/currencies/convert";
import type { ActionRow } from "./store";
import type { TradeMoneyActionMetadata } from "@/shared/trading/contract";
import { createConfirmActionHandler, createGetActionHandler, createGetPendingTradeHandler, createRetryActionHandler } from "./handler";

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
  return {
    product: "trade", direction,
    fromAsset: { address: direction === "sell" ? address : BASE_USDC_ADDRESS },
    toAsset: { address: direction === "buy" ? address : BASE_USDC_ADDRESS },
  } as unknown as TradeMoneyActionMetadata;
}

const request = (signature: string, provider: "base-account" | "cdp-embedded") => new Request(`https://home.test/api/actions/${ID}/confirm`, {
  method: "POST", headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" }, body: JSON.stringify({ signature }),
});

describe("trade confirmation", () => {
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
      product: "trade", direction: "buy", fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { address: ROUTER },
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
    expect(confirms).toBe(0);
  });

  test.each([
    ["buy", "base:eurc", "pair-paused"],
    ["sell", "base:eurc", "pair-paused"],
    ["buy", "base:eurc", "pair-withdrawn"],
    ["sell", "base:eurc", "pair-withdrawn"],
    ["buy", "base:wars", null],
    ["sell", "base:wars", null],
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
    expect(result.status).toBe(410);
    expect(await readJson(result)).toMatchObject({ error: { code: "ACTION_EXPIRED", message: "This trade is no longer available. Prepare it again." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
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
    expect(result.status).toBe(410);
    expect(await readJson(result)).toMatchObject({ error: { code: "ACTION_EXPIRED", message: "This trade is no longer available. Prepare it again." } });
    expect(confirms).toBe(0);
    expect(verifications).toBe(0);
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
    expect(result.status).toBe(410);
    expect(await readJson(result)).toMatchObject({ error: { code: "ACTION_EXPIRED", message: "This trade is no longer available. Prepare it again." } });
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
    row.summary.metadata = { product: "trade", direction: "buy", fromAsset, toAsset } as unknown as TradeMoneyActionMetadata;
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
    let committed = "";
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      verifySmartAccountSignature: async ({ smartAccount, permitHash }) => smartAccount === OWNER && permitHash === HASH,
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
  function replayHandler(row: ActionRow, provider: "base-account" | "cdp-embedded" = "cdp-embedded", convertPair?: typeof resolveConvertPair) {
    const effects = { confirms: 0, verifications: 0, recorded: 0, estimates: 0 };
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      convertPair,
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
