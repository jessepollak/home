import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseDeclineActionResponse } from "@/shared/actions/contracts/decline";
import { parseGetActionPendingResponse, parsePendingActionResponse, parsePresentedAction } from "@/shared/actions/contracts/get";
import { parseHandleActionErrorResponse, parseHandleActionResponse } from "@/shared/actions/contracts/handle";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { parseRetryActionResponse } from "@/shared/actions/contracts/retry";
import { isRecord } from "@/shared/guards";
import { requireAddress } from "@/shared/chain/hex";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { ACTION_KINDS, type ActionKind } from "@/shared/money-actions/types";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { parseJson, readJson } from "@/tests/helpers/read-json";
import { createDeclineActionHandler, createGetActionHandler, createHandleActionHandler, createListActionsHandler, createRetryActionHandler } from "./handler";
import { actionOwnerKey, type ActionRow, type CashoutOrderRow } from "./store";

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const INSTANT = "2026-10-01T12:00:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "owner" }, smartAccount: { address: ADDRESS, chainId: 8453 }, accountProvider: "cdp-embedded",
};
const owner = { subject: "owner", address: ADDRESS, chainId: 8453, accountProvider: "cdp-embedded" } as const;
const authorize = async () => session;
const context = { params: Promise.resolve({ id: ID }) };
const events: Array<Record<string, unknown>> = [];
beforeEach(() => {
  events.length = 0;
  setObservabilityLogWriterForTests((line) => {
    const event: unknown = JSON.parse(line);
    if (isRecord(event)) events.push(event);
  });
});
afterEach(() => setObservabilityLogWriterForTests());

function row(kind: ActionKind = "send"): ActionRow {
  const summary: ActionRow["summary"] = {
    title: kind, amounts: [], warnings: [], expiresAt: "2099-10-01T12:03:00.000Z",
  };
  if (kind === "card-allowance") {
    summary.metadata = { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
      token: requireAddress(BASE_USDC_ADDRESS), spender: TARGET, allowanceBaseUnits: "1000000", previousAllowanceBaseUnits: "0",
      maximumBaseUnits: "25000000", source: { blockNumber: "100" } };
  } else if (kind === "trade") {
    summary.metadata = {
      product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 }, assetId: "cbbtc", assetName: "Bitcoin",
      fromAsset: { id: "usdc", symbol: "USDC", decimals: 6, address: requireAddress(BASE_USDC_ADDRESS) },
      toAsset: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: requireAddress("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf") },
      fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "1000", minimumToAmountBaseUnits: "990",
      slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "100", quotedAt: INSTANT,
      permitDeadline: "4102444800", executionDeadline: "4102444800",
    };
    summary.signing = { signer: "cdp-embedded", evmAccount: requireAddress(ADDRESS), typedData: {
      domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: ADDRESS },
      types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }] },
      primaryType: "CoinbaseSmartWalletMessage", message: { hash: `0x${"ab".repeat(32)}` },
    } };
  }
  return {
    id: ID, owner_key: actionOwnerKey(owner), account_address: ADDRESS, provider: "cdp-embedded", kind, summary,
    pending: { calls: [{ to: TARGET, data: "0x1234", value: "0" }] }, created_at: INSTANT, confirmed_at: INSTANT,
    provider_handle: null, transaction_hash: null, handle_recorded_at: null, declined_reported_at: null,
    dispatch_attempt: 0, outcome: null, outcome_source: null, settled_at: null, outcome_recorded_at: null,
  };
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://home.test/api/actions/${ID}${path ? `/${path}` : ""}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Home-Account-Provider": "cdp-embedded", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function storeFor(action: ActionRow) {
  return {
    get: async () => action,
    recordDecline: async () => ({ row: action, changed: true }),
    beginRetry: async () => ({ row: action, conflict: false, dispatched: false }),
    recordHandle: async () => ({ ...action, provider_handle: "handle-1", handle_recorded_at: INSTANT }),
    recordOutcome: async () => { throw new Error("Unexpected outcome write"); },
  };
}

const routes = [
  {
    name: "decline", event: "action-decline", parse: parseDeclineActionResponse,
    run: (action: ActionRow) => createDeclineActionHandler({ authorize, store: storeFor(action) })(request("decline", { version: 1, attempt: 0 }), context),
  },
  {
    name: "retry", event: "action-retry", parse: parseRetryActionResponse,
    run: (action: ActionRow) => createRetryActionHandler({ authorize, store: storeFor(action), now: () => new Date(INSTANT),
      cardAllowanceSetAllowed: () => true, cardAllowanceEligible: async () => {} })(request("retry", { version: 1, attempt: 1 }), context),
  },
  {
    name: "confirmed read", event: "action-read", parse: parsePresentedAction,
    run: (action: ActionRow) => createGetActionHandler({ authorize, store: storeFor(action), now: () => new Date(INSTANT) })(request(""), context),
  },
  {
    name: "pending read", event: "action-read", parse: (value: unknown) => parseGetActionPendingResponse(value, ADDRESS),
    run: (action: ActionRow) => createGetActionHandler({ authorize, store: storeFor({ ...action, confirmed_at: null }), now: () => new Date(INSTANT) })(request(""), context),
  },
  {
    name: "handle", event: "action-handle", parse: parseHandleActionResponse,
    run: (action: ActionRow) => createHandleActionHandler({ authorize, store: storeFor(action), now: () => new Date(INSTANT) })(request("handle", { providerHandle: "handle-1" }), context),
  },
];

function route(name: string) {
  return defined(routes.find((entry) => entry.name === name));
}

function defined<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a test fixture value.");
  return value;
}

for (const route of routes) {
  describe(`${route.name} presented action validation`, () => {
    test.each(["non-string warning", "missing title", "null summary", "array summary", "string summary"])("fails closed for a stored summary with %s", async (malformation) => {
      const action = row();
      if (malformation === "null summary") Object.assign(action, { summary: null });
      else if (malformation === "array summary") Object.assign(action, { summary: [] });
      else if (malformation === "string summary") Object.assign(action, { summary: "invalid" });
      else Object.assign(action.summary, malformation === "missing title" ? { title: undefined } : { warnings: [1] });
      const response = await route.run(action);
      expect(response.status).toBe(503);
      const body = await readJson(response);
      expect(body).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
      expect(body).not.toHaveProperty("action");
      if (route.name === "handle") expect(parseHandleActionErrorResponse(body)?.error.code).toBe("ACTIONS_UNAVAILABLE");
      expect(events).toMatchObject([{ kind: route.event, code: "ACTION_UNPRESENTABLE", outcome: "failed", provider: "cdp-embedded" }]);
      expect(events[0]?.ownerHash).toBeString();
    });

    test.each(ACTION_KINDS.map((kind) => [kind] as const))("returns a contract-valid %s action", async (kind) => {
      const response = await route.run(row(kind));
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(route.parse(body)).not.toBeNull();
      if (route.name === "pending read") expect(parsePendingActionResponse(body, ID, session)?.kind).toBe(kind);
      expect(events).toEqual([]);
    });
  });
}

test.each(["empty calls", "malformed calls", "invalid expiry", "non-record signing", "card allowance missing metadata", "trade signing for another owner"])("pending read fails closed for %s", async (failure) => {
  const action = row(failure === "card allowance missing metadata" ? "card-allowance" : failure === "non-record signing" || failure === "trade signing for another owner" ? "trade" : "send");
  if (failure === "empty calls") action.pending = { calls: [] };
  if (failure === "malformed calls") Object.assign(defined(action.pending?.calls[0]), { data: "0xABC" });
  if (failure === "invalid expiry") action.summary.expiresAt = "invalid";
  if (failure === "non-record signing") Object.assign(action.summary, { signing: [] });
  if (failure === "card allowance missing metadata") delete action.summary.metadata;
  if (failure === "trade signing for another owner") Object.assign(defined(action.summary.signing).typedData.domain, { verifyingContract: TARGET });
  const response = await route("pending read").run(action);
  expect(response.status).toBe(503);
  expect(await readJson(response)).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE" }]);
});

test.each(["trade", "card-allowance"] as const)("retry fails closed before checking %s metadata when the summary is null", async (kind) => {
  const action = row(kind);
  Object.assign(action, { summary: null });
  const response = await route("retry").run(action);
  expect(response.status).toBe(503);
  const body = await readJson(response);
  expect(body).toMatchObject({ error: { code: "ACTIONS_UNAVAILABLE" } });
  expect(body).not.toHaveProperty("action");
  expect(events).toMatchObject([{ kind: "action-retry", code: "ACTION_UNPRESENTABLE", outcome: "failed" }]);
});

test.each(["cash-out", "savings-deposit"] as const)("list preserves malformed %s rows and emits one event across both collections", async (kind) => {
  const malformed = row(kind);
  malformed.id = "malformed-recent";
  Object.assign(malformed.summary, { warnings: [1] });
  const retained = row("savings-deposit");
  retained.id = "malformed-retained";
  Object.assign(retained.summary, { title: undefined });
  const valid = row("send");
  const handler = createListActionsHandler({
    authorize, store: { ...storeFor(valid), list: async () => [malformed, valid], listRetainedSavingsDeposits: async () => [retained] },
    refreshCashouts: async () => [], now: () => new Date(INSTANT),
  });
  const response = await handler(new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
  expect(response.status).toBe(200);
  const body = await readJson(response);
  expect(body).toMatchObject({ actions: [{ id: "malformed-recent", summary: { warnings: [1] } }, { id: ID }], retainedSavingsDeposits: [{ id: "malformed-retained" }] });
  const parsed = parseRecentActionsPayload(body, session);
  expect(parsed.operations.map((operation) => operation.action.id)).toEqual([ID]);
  expect(parsed.incomplete).toBe(kind === "cash-out");
  expect(parsed.unparsedSavingsDeposits).toHaveLength(kind === "savings-deposit" ? 2 : 1);
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE", outcome: "failed" }]);
  expect(events).toHaveLength(1);
});

test.each([[null], [[]], ["invalid"], [1], ["non-string depositId"]] as const)("list preserves a malformed withdrawal summary %j with the default cash-out refresher", async (summary) => {
  const deposit = row("cash-out");
  deposit.outcome = "succeeded";
  deposit.summary.metadata = {
    product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production", region: "US",
    platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice",
    approximateFiatAmount: "1", minConversionRate: "1", intentAmountRange: { min: "1", max: "2" }, estimateAsOf: INSTANT, escrow: TARGET,
  };
  const withdrawal = row("cash-out-withdraw");
  withdrawal.id = "malformed-withdrawal";
  withdrawal.provider_handle = `0x${"ab".repeat(32)}`;
  if (summary === "non-string depositId") {
    withdrawal.provider_handle = null;
    Object.assign(withdrawal.summary, { metadata: {
      ...deposit.summary.metadata, operation: "withdraw", canonicalHandle: undefined, depositId: 1,
    } });
  } else Object.assign(withdrawal, { summary });
  const record: CashoutOrderRow = {
    action_id: deposit.id, owner_key: deposit.owner_key, provider_id: "peer", environment: "production", region: "US",
    deposit_id: "escrow-1", deposit_proven: true, state: "delivered", platform: "cashapp", platform_label: "Cash App",
    amount_atomic: "1000000", filled_atomic: "1000000", returned_atomic: "0", remaining_atomic: "0", withdrawable: false,
    eta_seconds: null, created_at: INSTANT, updated_at: INSTANT, refreshed_at: INSTANT, settled_at: INSTANT,
  };
  const ensureCashoutOrder = mock(async () => record);
  const cashoutOrders = mock(async () => [record]);
  const resolveHandle = mock(async () => ({ status: "pending" as const }));
  const handler = createListActionsHandler({
    authorize, store: { ...storeFor(deposit), list: async () => [deposit, withdrawal], ensureCashoutOrder, cashoutOrders },
    resolveHandle, now: () => new Date(Date.parse(INSTANT) + 30_000),
  });
  const response = await handler(new Request("https://home.test/api/actions"));
  expect(response.status).toBe(200);
  const body = await readJson(response);
  expect(body).toMatchObject({ actions: [{ id: deposit.id, cashout: { depositId: "escrow-1", withdrawing: false } }, { id: withdrawal.id }] });
  expect(body).toHaveProperty("actions.1.summary", parseJson(JSON.stringify(withdrawal.summary)));
  const parsed = parseRecentActionsPayload(body, session);
  expect(parsed.operations.map((operation) => operation.action.id)).toEqual([deposit.id]);
  expect(parsed.incomplete).toBe(true);
  expect(ensureCashoutOrder).toHaveBeenCalledTimes(1);
  expect(cashoutOrders).toHaveBeenCalledTimes(1);
  expect(resolveHandle).not.toHaveBeenCalled();
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE", outcome: "failed" }]);
  expect(events).toHaveLength(1);
});

test.each([
  ["an in-flight withdrawal with a null summary", null, true, true, false],
  ["an in-flight withdrawal with a non-string depositId", null, true, true, false],
  ["an in-flight withdrawal with a blank depositId", null, true, true, false],
  ["an in-flight withdrawal with a whitespace depositId", null, true, true, false],
  ["an in-flight withdrawal with a padded depositId", null, true, true, true],
  ["a resolved unlinkable withdrawal", "succeeded", true, false, false],
  ["an unlinkable in-flight withdrawal and a non-withdrawable deposit", null, false, false, false],
] as const)("list conservatively presents cash-out progress for %s", async (scenario, outcome, withdrawable, withdrawing, withdrawalParses) => {
  const deposit = row("cash-out");
  deposit.outcome = "succeeded";
  deposit.summary.metadata = {
    product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production", region: "US",
    platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice",
    approximateFiatAmount: "1", minConversionRate: "1", intentAmountRange: { min: "1", max: "2" }, estimateAsOf: INSTANT, escrow: TARGET,
  };
  const withdrawal = row("cash-out-withdraw");
  withdrawal.id = "malformed-withdrawal";
  withdrawal.provider_handle = `0x${"ab".repeat(32)}`;
  withdrawal.handle_recorded_at = INSTANT;
  withdrawal.outcome = outcome;
  if (scenario === "an in-flight withdrawal with a non-string depositId") {
    Object.assign(withdrawal.summary, { metadata: {
      ...deposit.summary.metadata, operation: "withdraw", canonicalHandle: undefined, depositId: 1,
    } });
  } else if (scenario === "an in-flight withdrawal with a blank depositId" || scenario === "an in-flight withdrawal with a whitespace depositId" || scenario === "an in-flight withdrawal with a padded depositId") {
    Object.assign(withdrawal.summary, { metadata: {
      ...deposit.summary.metadata, operation: "withdraw", canonicalHandle: undefined,
      depositId: scenario === "an in-flight withdrawal with a blank depositId" ? "" : scenario === "an in-flight withdrawal with a whitespace depositId" ? "  " : " escrow-1 ",
    } });
  } else Object.assign(withdrawal, { summary: null });
  const record: CashoutOrderRow = {
    action_id: deposit.id, owner_key: deposit.owner_key, provider_id: "peer", environment: "production", region: "US",
    deposit_id: "escrow-1", deposit_proven: true, state: "awaiting-buyer", platform: "cashapp", platform_label: "Cash App",
    amount_atomic: "1000000", filled_atomic: "1000000", returned_atomic: "0", remaining_atomic: "1000000", withdrawable,
    eta_seconds: null, created_at: INSTANT, updated_at: INSTANT, refreshed_at: INSTANT, settled_at: null,
  };
  const refreshCashouts = mock(async () => [{ ...record, progressConfirmed: true }]);
  const handler = createListActionsHandler({
    authorize, store: { ...storeFor(deposit), list: async () => [deposit, withdrawal] },
    refreshCashouts, now: () => new Date(INSTANT),
  });
  const response = await handler(new Request("https://home.test/api/actions"));
  expect(response.status).toBe(200);
  const body = await readJson(response);
  expect(body).toMatchObject({ actions: [{ id: deposit.id, cashout: { depositId: "escrow-1", withdrawable, withdrawing } }, { id: withdrawal.id }] });
  expect(body).toHaveProperty("actions.1.summary", parseJson(JSON.stringify(withdrawal.summary)));
  const parsed = parseRecentActionsPayload(body, session);
  expect(parsed.operations.map((operation) => operation.action.id)).toEqual(withdrawalParses ? [deposit.id, withdrawal.id] : [deposit.id]);
  expect(parsed.incomplete).toBe(!withdrawalParses);
  expect(refreshCashouts).toHaveBeenCalledTimes(1);
  expect(refreshCashouts).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ row: deposit, receipt: null })] }));
  if (withdrawalParses) expect(events).toEqual([]);
  else {
    expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE", outcome: "failed" }]);
    expect(events).toHaveLength(1);
  }
});

test.each(["handle", "receipt"])("list preserves a null-summary non-cash-out row without %s enrichment", async (enrichment) => {
  const malformed = row();
  malformed.id = "malformed-send";
  if (enrichment === "handle") malformed.provider_handle = `0x${"ab".repeat(32)}`;
  else malformed.transaction_hash = `0x${"ab".repeat(32)}`;
  Object.assign(malformed, { summary: null });
  const valid = row();
  const resolveHandle = mock(async () => ({ status: "pending" as const }));
  const readReceipt = mock(async () => ({ status: "pending" as const, transactionHash: `0x${"ab".repeat(32)}` as const, finalizedBlockNumber: "0" }));
  const handler = createListActionsHandler({
    authorize, store: { ...storeFor(valid), list: async () => [malformed, valid] }, resolveHandle, readReceipt,
    now: () => new Date(Date.parse(INSTANT) + 30_000),
  });
  const response = await handler(new Request("https://home.test/api/actions"));
  expect(response.status).toBe(200);
  const body = await readJson(response);
  expect(body).toMatchObject({ actions: [{ id: malformed.id, summary: null }, { id: valid.id }] });
  const parsed = parseRecentActionsPayload(body, session);
  expect(parsed.operations.map((operation) => operation.action.id)).toEqual([valid.id]);
  expect(parsed.incomplete).toBe(false);
  expect(resolveHandle).not.toHaveBeenCalled();
  expect(readReceipt).not.toHaveBeenCalled();
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE" }]);
  expect(events).toHaveLength(1);
});

test("list emits an unpresentable event for amounts rejected by the client", async () => {
  const malformed = row();
  Object.assign(malformed.summary, { amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "-1", direction: "spend" }] });
  const handler = createListActionsHandler({ authorize, store: { ...storeFor(malformed), list: async () => [malformed] } });
  const response = await handler(new Request("https://home.test/api/actions"));
  expect(response.status).toBe(200);
  const body = await readJson(response);
  expect(body).toMatchObject({ actions: [{ summary: { amounts: [{ amountBaseUnits: "-1" }] } }] });
  expect(parseRecentActionsPayload(body, session).operations).toEqual([]);
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE" }]);
  expect(events).toHaveLength(1);
});

test("list validates retained savings rows even when recent actions are all valid", async () => {
  const valid = row();
  const retained = row("savings-deposit");
  retained.id = "malformed-retained";
  Object.assign(retained.summary, { warnings: [1] });
  const handler = createListActionsHandler({
    authorize, store: { ...storeFor(valid), list: async () => [valid], listRetainedSavingsDeposits: async () => [retained] },
    refreshCashouts: async () => [], now: () => new Date(INSTANT),
  });
  const response = await handler(new Request("https://home.test/api/actions"));
  expect(response.status).toBe(200);
  const parsed = parseRecentActionsPayload(await readJson(response), session);
  expect(parsed.operations).toHaveLength(1);
  expect(parsed.unparsedSavingsDeposits).toHaveLength(1);
  expect(events).toMatchObject([{ kind: "action-read", code: "ACTION_UNPRESENTABLE" }]);
  expect(events).toHaveLength(1);
});
