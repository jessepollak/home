import { readJson } from "@/tests/helpers/read-json";
import { isRecord } from "@/shared/guards";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseActivityOrders } from "@/shared/activity/contract-orders";
import { MemoryFundingOrderStore, type FundingOrder, type FundingReservation } from "@/server/funding/core/store";
import type { CashoutOrderRow } from "@/server/actions/store";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createActivityOrdersHandler } from "./orders-handler";

const session: VerifiedAccountSession = { user: { subject: "owner" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const request = () => new Request("https://home.example/api/activity/orders", { headers: { "X-Home-Account-Provider": "base-account" } });
const funding = { id: "owned", owner: { subject: "owner", accountProvider: "base-account" }, state: "received", assetId: "base:usdc", providerId: "coinbase", region: "US", paymentMethod: "apple-pay", fiatAmount: "10", expectedTokenAmountAtomic: "10000000", quote: { tokenAmountAtomic: "10000000" }, sandbox: false, expiresAt: null, instructions: null, transactionHash: null, logIndex: null, providerOrderId: "provider-1", createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T01:00:00.000Z" } as FundingOrder;
const cashout = { action_id: "cashout", provider_id: "peer", region: "US", deposit_id: "deposit-1", state: "delivered", platform: "cashapp", platform_label: "Cash App", amount_atomic: "1000000", filled_atomic: "1000000", returned_atomic: "0", remaining_atomic: "0", withdrawable: false, settled_at: null, created_at: "2026-09-12T00:00:00.000Z", updated_at: "2026-09-12T02:00:00.000Z" } as CashoutOrderRow;

beforeEach(() => setObservabilityLogWriterForTests(() => undefined));
afterEach(() => setObservabilityLogWriterForTests());

test("rejects unauthenticated requests without consulting either source", async () => {
  let queried = false;
  const get = createActivityOrdersHandler({
    authorize: async () => Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    listFundingOrders: async () => { queried = true; return []; }, getOpenFundingOrder: async () => { queried = true; return null; },
    listCashoutOrders: async () => { queried = true; return []; },
  });
  const response = await get(request());
  expect(response.status).toBe(401);
  expect(queried).toBe(false);
});

test("rejects a session without a verified Base smart account before either source", async () => {
  let queried = false;
  const get = createActivityOrdersHandler({ authorize: async () => ({ ...session, smartAccount: null }),
    listFundingOrders: async () => { queried = true; return []; }, getOpenFundingOrder: async () => { queried = true; return null; },
    listCashoutOrders: async () => { queried = true; return []; },
  });
  const response = await get(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect(queried).toBe(false);
});

test("echoes verified owner, fences source queries and merges newest updates", async () => {
  let fundingOwner = "";
  let cashoutOwner = "";
  let openOwner = "";
  const get = createActivityOrdersHandler({
    authorize: async () => session,
    listFundingOrders: async (current, limit) => {
      fundingOwner = current.user.subject;
      expect(current.accountProvider).toBe("base-account");
      expect(limit).toBe(50);
      return current.user.subject === funding.owner.subject ? [funding] : [];
    },
    getOpenFundingOrder: async (current, region) => { openOwner = current.user.subject; expect(region).toBe("US"); return null; },
    listCashoutOrders: async (owner, limit) => {
      cashoutOwner = owner.subject;
      expect(owner.address).toBe(session.smartAccount!.address);
      expect(limit).toBe(50);
      return owner.subject === "owner" ? [cashout] : [];
    },
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  });
  const response = await get(request());
  const body = await readJson(response);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect({ fundingOwner, cashoutOwner, openOwner }).toEqual({ fundingOwner: "owner", cashoutOwner: "owner", openOwner: "owner" });
  expect(isRecord(body) ? body.owner : body).toEqual({ subject: "owner", accountProvider: "base-account" });
  expect(parseActivityOrders(body, session).map((order) => order.id)).toEqual(["cashout", "owned"]);
  expect(() => parseActivityOrders(body, { ...session, user: { subject: "other" } })).toThrow();
  expect(() => parseActivityOrders(body, { ...session, accountProvider: "cdp-embedded" })).toThrow();
  expect(JSON.stringify(body)).not.toContain("provider-1");
});

test("polling updates do not reorder unpaid funding history, including expired checkout", async () => {
  const pending = { ...funding, id: "pending", state: "awaiting-payment" as const, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-12T03:00:00.000Z" };
  const get = createActivityOrdersHandler({ authorize: async () => session, listFundingOrders: async () => [pending, funding], getOpenFundingOrder: async () => null, listCashoutOrders: async () => [cashout], now: () => new Date("2026-09-12T12:00:00.000Z") });
  const orders = parseActivityOrders(await (await get(request())).json(), session);
  expect(orders.map((order) => order.id)).toEqual(["cashout", "owned", "pending"]);
  expect(orders[2]).toMatchObject({ stage: "expired", createdAt: pending.createdAt, updatedAt: pending.updatedAt, movedAt: pending.createdAt });
});

test("real handler orders reject every truncated field independently while preserving valid siblings", async () => {
  const olderFunding = { ...funding, id: "older", updatedAt: "2026-09-12T00:30:00.000Z" };
  const get = createActivityOrdersHandler({
    authorize: async () => session,
    listFundingOrders: async () => [funding, olderFunding],
    getOpenFundingOrder: async () => null,
    listCashoutOrders: async () => [cashout],
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  });
  const body = await readJson(await get(request()));
  if (!isRecord(body) || !Array.isArray(body.orders)) throw new Error("Expected handler orders");
  const parsed = parseActivityOrders(body, session);
  expect(parsed.map(({ id }) => id)).toEqual(["cashout", "owned", "older"]);
  for (const [index, order] of body.orders.entries()) {
    if (!isRecord(order)) throw new Error("Expected a handler order record");
    for (const key of Object.keys(order)) {
      if (key === "movedAt") continue;
      const truncated: Record<string, unknown> = { ...order };
      delete truncated[key];
      const orders = [...body.orders];
      orders[index] = truncated;
      expect(parseActivityOrders({ ...body, orders }, session))
        .toEqual(parsed.filter((_, current) => current !== index));
    }
  }
  for (const [index, order] of body.orders.entries()) {
    if (!isRecord(order) || order.kind !== "funding" || !isRecord(order.asset)) continue;
    for (const key of Object.keys(order.asset)) {
      const asset: Record<string, unknown> = { ...order.asset };
      delete asset[key];
      const orders = [...body.orders];
      orders[index] = { ...order, asset };
      expect(parseActivityOrders({ ...body, orders }, session))
        .toEqual(parsed.filter((_, current) => current !== index));
    }
  }
  const envelopeCases: unknown[] = [
    { owner: body.owner, orders: body.orders },
    { ...body, version: 2 },
    { ...body, version: "1" },
    { version: body.version, orders: body.orders },
    { ...body, owner: null },
    { ...body, owner: "owner" },
    { ...body, owner: { subject: "another", accountProvider: session.accountProvider } },
    { version: body.version, owner: body.owner },
    { ...body, orders: null },
    { ...body, orders: {} },
  ];
  for (const malformed of envelopeCases) {
    expect(() => parseActivityOrders(malformed, session)).toThrow();
  }
});

test("real handler orders reject malformed field values while preserving the other order", async () => {
  const get = createActivityOrdersHandler({
    authorize: async () => session,
    listFundingOrders: async () => [funding],
    getOpenFundingOrder: async () => null,
    listCashoutOrders: async () => [cashout],
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  });
  const body = await readJson(await get(request()));
  if (!isRecord(body) || !Array.isArray(body.orders)) throw new Error("Expected handler orders");
  const surviving = parseActivityOrders(body, session).map(({ id }) => id);
  const cases: readonly (readonly [string, string, Record<string, unknown>])[] = [
    ["unknown status", "funding", { status: "settled" }],
    ["unknown funding stage", "funding", { stage: "arrived" }],
    ["unknown instruction", "funding", { instruction: "wire" }],
    ["unknown order kind", "funding", { kind: "transfer" }],
    ["negative atomic token amount", "funding", { tokenAmountAtomic: "-1" }],
    ["fractional atomic token amount", "funding", { tokenAmountAtomic: "1.5" }],
    ["zero-padded log index", "funding", { transactionHash: `0x${"a".repeat(64)}`, logIndex: "012" }],
    ["fractional asset decimals", "funding", { asset: { id: "usdc", symbol: "USDC", decimals: 6.5 } }],
    ["unparseable created timestamp", "funding", { createdAt: "not-a-timestamp" }],
    ["empty provider name", "funding", { providerName: "" }],
    ["unknown cash-out state", "cash-out", { state: "held" }],
    ["fractional atomic cash-out amount", "cash-out", { amountAtomic: "1000000.5" }],
    ["negative returned amount", "cash-out", { returnedAtomic: "-1" }],
    ["non-boolean withdrawable flag", "cash-out", { withdrawable: "true" }],
    ["unparseable settled timestamp", "cash-out", { settledAt: "not-a-timestamp" }],
  ];
  for (const [label, kind, patch] of cases) {
    const index = body.orders.findIndex((order) => isRecord(order) && order.kind === kind);
    const target = body.orders[index];
    if (index < 0 || !isRecord(target)) throw new Error(`Expected a ${kind} handler order`);
    const orders = [...body.orders];
    orders[index] = { ...target, ...patch };
    expect([label, parseActivityOrders({ ...body, orders }, session).map(({ id }) => id)])
      .toEqual([label, surviving.filter((_, current) => current !== index)]);
  }
});

test("only the latest updated open order per region is resumable, fenced to the owner", async () => {
  const store = new MemoryFundingOrderStore();
  const reservation: FundingReservation = {
    id: "older", owner: { subject: session.user.subject, accountProvider: session.accountProvider }, destination: session.smartAccount!.address,
    providerId: "coinbase", region: "US", assetId: "base:usdc", paymentMethod: "apple-pay", fiatAmount: "25", intentDigest: "older",
    quote: { fiatAmount: "25", tokenAmountAtomic: "25000000", fees: [], expiresAt: "2026-09-13T00:00:00.000Z" },
    quoteToken: "older", customerRef: null, sandbox: false, creationBlock: "100", createdAt: "2026-09-12T00:00:00.000Z",
  };
  for (const [id, createdAt, instruction] of [
    ["older", "2026-09-12T00:00:00.000Z", { kind: "redirect", url: "https://example.com" }],
    ["newer", "2026-09-12T01:00:00.000Z", { kind: "qr", scheme: "qris", payload: "payment", amount: "25", currency: "USD" }],
  ] as const) {
    await store.reserve({ ...reservation, id, intentDigest: id, quoteToken: id, createdAt });
    await store.completeDispatch(id, { providerOrderId: id, expectedTokenAmountAtomic: "25000000", fees: [], expiresAt: null,
      instructions: instruction, expectedVersion: 0, updatedAt: createdAt });
  }
  await store.applyObservation("older", { state: "awaiting-payment", providerStatus: "pending", expectedVersion: 1, updatedAt: "2026-09-12T02:00:00.000Z" });
  const otherOwner = { subject: "other", accountProvider: session.accountProvider };
  await store.reserve({ ...reservation, id: "other", owner: otherOwner, intentDigest: "other", quoteToken: "other", createdAt: "2026-09-12T03:00:00.000Z" });
  const get = createActivityOrdersHandler({
    authorize: async () => session,
    listFundingOrders: (current, limit) => store.listOwned({ subject: current.user.subject, accountProvider: current.accountProvider }, limit),
    getOpenFundingOrder: (current, region) => store.getOpen({ subject: current.user.subject, accountProvider: current.accountProvider }, region),
    listCashoutOrders: async () => [], now: () => new Date("2026-09-12T04:00:00.000Z"),
  });
  const parsed = parseActivityOrders(await readJson((await get(request()))), session);
  expect(parsed.map(({ id }) => id)).toEqual(["newer", "older"]);
  expect(parsed.map((order) => order.kind === "funding" ? [order.id, order.resumable] : [])).toEqual([["newer", false], ["older", true]]);
  expect(await store.getOpen(otherOwner, "US")).toMatchObject({ id: "other" });
  expect(await store.getOpen({ subject: session.user.subject, accountProvider: session.accountProvider }, "US")).toMatchObject({ id: "older" });
});

test("rejects funding responses missing a boolean resumable flag", () => {
  const valid = { version: 1, owner: { subject: session.user.subject, accountProvider: session.accountProvider }, orders: [{
    kind: "funding", id: "owned", region: "US", providerId: "coinbase", providerName: "Coinbase", paymentMethodLabel: "Card",
    status: "waiting-customer", stage: "awaiting-payment", instruction: "embed", resumable: true, fiatAmount: "25", fiatCurrency: "USD",
    asset: { id: "usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "25000000", sandbox: false, expiresAt: null,
    clearableAt: null, transactionHash: null, logIndex: null, createdAt: funding.createdAt, updatedAt: funding.updatedAt,
  }] };
  expect(parseActivityOrders(valid, session)).toHaveLength(1);
  for (const resumable of [undefined, "true", 1, null]) {
    expect(parseActivityOrders({ ...valid, orders: [{ ...valid.orders[0], resumable }] }, session)).toEqual([]);
  }
});

test("funding order parser requires a decimal log index and a hash for non-null indexes", () => {
  const valid = { version: 1, owner: { subject: session.user.subject, accountProvider: session.accountProvider }, orders: [{
    kind: "funding", id: "owned", region: "US", providerId: "coinbase", providerName: "Coinbase", paymentMethodLabel: "Card",
    status: "confirmed", stage: "received", instruction: null, resumable: false, fiatAmount: "25", fiatCurrency: "USD",
    asset: { id: "usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "25000000", sandbox: false, expiresAt: null,
    clearableAt: null, transactionHash: `0x${"a".repeat(64)}`, logIndex: "12", createdAt: funding.createdAt, updatedAt: funding.updatedAt,
  }] };
  expect(parseActivityOrders(valid, session)).toMatchObject([{ logIndex: "12" }]);
  expect(parseActivityOrders({ ...valid, orders: [{ ...valid.orders[0], logIndex: null }] }, session)).toHaveLength(1);
  for (const logIndex of [undefined, -1, 1, "-1", "1.5", "01", "1e2", ""]) {
    expect(parseActivityOrders({ ...valid, orders: [{ ...valid.orders[0], logIndex }] }, session)).toEqual([]);
  }
  expect(parseActivityOrders({ ...valid, orders: [{ ...valid.orders[0], transactionHash: null, logIndex: "12" }] }, session)).toEqual([]);
});

test("returns private 503 and a scrubbed event when either source fails", async () => {
  const events: string[] = [];
  setObservabilityLogWriterForTests((line) => events.push(line));
  for (const source of ["funding", "cashout", "open"]) {
    const get = createActivityOrdersHandler({
      authorize: async () => session,
      listFundingOrders: async () => { if (source === "funding") throw new Error("secret failure"); return source === "open" ? [funding] : []; },
      getOpenFundingOrder: async () => { throw new Error("secret failure"); },
      listCashoutOrders: async () => { if (source === "cashout") throw new Error("secret failure"); return []; },
    });
    const response = await get(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(await readJson(response)).toEqual({ code: "ORDERS_UNAVAILABLE" });
  }
  expect(events).toHaveLength(3);
  expect(events.join(" ")).not.toContain("secret failure");
  expect(events.join(" ")).not.toContain("subject");
});
