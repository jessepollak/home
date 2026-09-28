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
  expect(JSON.stringify(body)).not.toContain("provider-1");
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
  expect(parsed.map(({ id }) => id)).toEqual(["older", "newer"]);
  expect(parsed.map((order) => order.kind === "funding" ? [order.id, order.resumable] : [])).toEqual([["older", true], ["newer", false]]);
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
