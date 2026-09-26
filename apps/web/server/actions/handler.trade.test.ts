import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { keccak256 } from "viem";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import type { ActionRow } from "./store";
import type { TradeMoneyActionMetadata } from "@/shared/trading/contract";
import { createConfirmActionHandler, createGetActionHandler, createRetryActionHandler } from "./handler";

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
      signerAddress: SIGNER.address.toLowerCase() as `0x${string}`, signerOwnerIndex: 0, signerDeployed: true, swapCallIndex: 2 },
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

const request = (signature: string, provider: "base-account" | "cdp-embedded") => new Request(`https://home.test/api/actions/${ID}/confirm`, {
  method: "POST", headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" }, body: JSON.stringify({ signature }),
});

describe("trade confirmation", () => {
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
    const body = await response.json();
    expect(body.calls).toHaveLength(3);
    expect(body.calls[0]).toEqual(feeCall);
    expect(body.calls[1]).toEqual(approval);
    expect(body.calls[2].data).toStartWith("0x1234");
    expect(body.calls[2].data.length).toBeGreaterThan(swap.data.length);
    expect(committed).toBe(keccak256(encodeCoinbaseExecuteBatch(body.calls)));
  });
  test("reload returns the verified trade signing request", async () => {
    const row = tradeRow("cdp-embedded", "2026-09-25T12:03:00.000Z");
    row.summary.signing = { signer: "cdp-embedded", evmAccount: SIGNER.address.toLowerCase() as `0x${string}`, typedData: typed };
    const handler = createGetActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }),
      store: { get: async () => row, recordHandle: async () => null, recordOutcome: async () => ({ row: null, written: false, conflict: false }) },
    });
    const result = await handler(new Request(`https://home.test/api/actions/${ID}`, { headers: { "X-Home-Account-Provider": "cdp-embedded" } }), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ kind: "trade", signing: { signer: "cdp-embedded", typedData: typed } });
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
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_TRADE_SIGNATURE" } });
  });
  test("returns ACTION_EXPIRED before verifying a stale signature", async () => {
    const row = tradeRow("base-account", "2026-09-25T12:00:00.000Z");
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "base-account" }),
      now: () => new Date("2026-09-25T12:01:00.000Z"), store: { get: async () => row, confirm: async () => { throw new Error("Must not confirm"); } },
    });
    const response = await handler(request("0x1234", "base-account"), context);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
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
  function replayHandler(row: ActionRow, provider: "base-account" | "cdp-embedded" = "cdp-embedded") {
    const effects = { confirms: 0, verifications: 0, recorded: 0, estimates: 0 };
    const handler = createConfirmActionHandler({
      authorize: async () => Response.json({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider }),
      now: () => new Date("2026-09-25T12:01:00.000Z"),
      verifySmartAccountSignature: async () => { effects.verifications += 1; return true; },
      estimateBaseBatch: async () => { effects.estimates += 1; return BigInt(100_000); },
      markHot: async () => {}, recordConfirmed: async () => { effects.recorded += 1; },
      store: { get: async () => row, confirm: async () => { effects.confirms += 1; throw new Error("Must not confirm"); } },
    });
    return { effects, confirm: (provider: "base-account" | "cdp-embedded") => handler(new Request(`https://home.test/api/actions/${ID}/confirm`, {
      method: "POST", headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" }, body: "{}",
    }), context) };
  }

  test.each(["base-account", "cdp-embedded"] as const)("returns the committed %s plan without re-finalizing", async (provider) => {
    const row = confirmedRow((value) => { value.provider = provider; value.owner_key = JSON.stringify(["owner", OWNER, 8453, provider]); });
    const { effects, confirm } = replayHandler(row, provider);
    const response = await confirm(provider);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.calls).toEqual(finalized);
    expect(Boolean(body.batchGasLimit)).toBe(provider === "base-account");
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: provider === "base-account" ? 1 : 0 });
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
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_NOT_FOUND" } });
    expect(effects.confirms).toBe(0);
  });

  test("refuses replay after the maker deadline even when the taker permit remains valid", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = retryRow(String(Date.parse("2026-09-25T12:03:00.000Z") / 1000), String(Date.parse("2026-09-25T12:00:59.000Z") / 1000)).summary.metadata;
    });
    const { effects, confirm } = replayHandler(row);
    const response = await confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
    expect(effects).toEqual({ confirms: 0, verifications: 0, recorded: 0, estimates: 0 });
  });
  test.each([undefined, "invalid", String(Date.parse("2026-09-25T12:04:00.000Z") / 1000)])("refuses replay with an invalid execution deadline %s", async (deadline) => {
    const row = confirmedRow((value) => {
      value.summary.metadata = { product: "trade", permitDeadline: String(Date.parse("2026-09-25T12:03:00.000Z") / 1000), executionDeadline: deadline } as TradeMoneyActionMetadata;
    });
    const response = await replayHandler(row).confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
  });
  test("refuses replay within 30 seconds of the permit deadline", async () => {
    const row = confirmedRow((value) => {
      value.summary.metadata = { product: "trade", permitDeadline: String(Date.parse("2026-09-25T12:01:30.000Z") / 1000), executionDeadline: String(Date.parse("2026-09-25T12:01:30.000Z") / 1000) } as TradeMoneyActionMetadata;
    });
    const response = await replayHandler(row).confirm("cdp-embedded");
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
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
    expect(await response.json()).toEqual({ error: { code: "ACTION_EXPIRED", message: "The trade quote expired. Get a new quote." } });
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
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
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
    expect(await response.json()).toMatchObject({ error: { code: "ACTION_EXPIRED" } });
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
    expect(await response.json()).toMatchObject({ action: { id: ID } });
    expect(retries).toBe(1);
  });
});
