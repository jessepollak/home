import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider } from "@/shared/funding/provider-contract";
import { presentFundingOrder } from "@/server/activity/orders";
import { FundingCore, AMBIGUOUS_ORDER_RECOVERY_DELAY_MS } from "./service";
import { MemoryFundingOrderStore, type FundingReservation } from "./store";

const session: VerifiedAccountSession = { user: { subject: "history-owner" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const now = new Date("2026-09-14T12:00:00.000Z");
const quote = { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2026-09-12T12:00:00.000Z" };
const provider: FundingProvider = {
  manifest: { id: "fixture", displayName: "Fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" },
    bindings: [{ region: "ID", assetId: "base:idrx", currency: "IDR", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: [] } } }] },
  onramp: { async createOrder() { throw new Error("history must not dispatch"); }, async getOrder() { return { state: "payment-received", providerStatus: "received" }; } },
};
function reservation(id: string, createdAt: string): FundingReservation {
  return { id, owner: { subject: session.user.subject, accountProvider: session.accountProvider }, destination: session.smartAccount!.address,
    providerId: "fixture", region: "ID", assetId: "base:idrx", paymentMethod: "bank", fiatAmount: "20000", intentDigest: id,
    quote, quoteToken: id, customerRef: null, sandbox: false, creationBlock: "100", createdAt };
}

test("history rotates over two eligible rows in creation order without dispatch or reordering", async () => {
  const store = new MemoryFundingOrderStore();
  const refreshed: string[] = [];
  const core = new FundingCore({ providers: [{ ...provider, onramp: { ...provider.onramp!, async getOrder(input) { refreshed.push(input.providerOrderId); return { state: "payment-received", providerStatus: "received" }; } } }], store,
    currentBaseBlock: async () => "100", verifyReceipt: async () => null, now: () => now, random: () => 0 });
  for (const [id, createdAt] of [["old", "2026-09-12T00:00:00.000Z"], ["middle", "2026-09-12T01:00:00.000Z"], ["new", "2026-09-12T02:00:00.000Z"]]) {
    const input = reservation(id!, createdAt!);
    await store.reserve(input);
    await store.completeDispatch(id!, { providerOrderId: id!, expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null,
      instructions: { kind: "qr", scheme: "qris", payload: "payment", amount: "20000", currency: "IDR" }, expectedVersion: 0, updatedAt: createdAt! });
  }
  await store.applyObservation("old", { state: "awaiting-payment", providerStatus: "pending", expectedVersion: 1,
    updatedAt: "2026-09-14T10:00:00.000Z" });
  const terminal = reservation("terminal", "2026-09-12T03:00:00.000Z");
  await store.reserve(terminal);
  await store.markDispatchAmbiguous(terminal.id, 0, terminal.createdAt);
  expect((await core.listOrderHistory(session)).map(({ id, state }) => [id, state])).toEqual([
    ["terminal", "dispatch-ambiguous"], ["new", "awaiting-payment"], ["middle", "payment-received"], ["old", "payment-received"],
  ]);
  expect(refreshed).toEqual(["old", "middle"]);
  expect((await core.listOrderHistory(session, 1)).map(({ id }) => id)).toEqual(["terminal"]);
  await store.reserve({ ...reservation("other-subject", "2026-09-12T04:00:00.000Z"), owner: { subject: "other", accountProvider: session.accountProvider } });
  await store.reserve({ ...reservation("other-provider", "2026-09-12T05:00:00.000Z"), owner: { subject: session.user.subject, accountProvider: "cdp-embedded" } });
  expect((await core.listOrderHistory(session)).map(({ id }) => id)).toEqual(["terminal", "new", "middle", "old"]);
  for (const limit of [0, 101, -1, 1.5]) await expect(core.listOrderHistory(session, limit)).rejects.toThrow();
});

test("history rotation reaches all eligible orders when provider reads keep failing", async () => {
  const store = new MemoryFundingOrderStore();
  let time = now;
  const rolls = [0, 0.5];
  const attempts: string[] = [];
  const core = new FundingCore({ providers: [{ ...provider, onramp: { ...provider.onramp!, async getOrder(input) {
    attempts.push(input.providerOrderId);
    if (["first", "second"].includes(input.providerOrderId)) throw new Error("provider unavailable");
    return { state: "payment-received", providerStatus: "received" };
  } } }], store, currentBaseBlock: async () => "100", verifyReceipt: async () => null, now: () => time, random: () => rolls.shift() ?? 0 });
  for (const [index, id] of ["first", "second", "third", "fourth"].entries()) {
    const createdAt = new Date(now.getTime() - (4 - index) * 60_000).toISOString();
    await store.reserve(reservation(id, createdAt));
    await store.completeDispatch(id, { providerOrderId: id, expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null,
      instructions: { kind: "qr", scheme: "qris", payload: "payment", amount: "20000", currency: "IDR" }, expectedVersion: 0, updatedAt: createdAt });
  }
  const recent = reservation("recent", now.toISOString());
  await store.reserve(recent);
  await store.completeDispatch(recent.id, { providerOrderId: recent.id, expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null,
    instructions: { kind: "qr", scheme: "qris", payload: "payment", amount: "20000", currency: "IDR" }, expectedVersion: 0, updatedAt: recent.createdAt });
  await core.listOrderHistory(session);
  expect(attempts).toEqual(["first", "second"]);
  time = new Date(time.getTime() + 5_000);
  const history = await core.listOrderHistory(session);
  expect(attempts).toEqual(["first", "second", "third", "fourth"]);
  expect(history.map(({ id }) => id)).toEqual(["recent", "fourth", "third", "second", "first"]);
  expect(history.filter(({ state }) => state === "payment-received").map(({ id }) => id)).toEqual(["fourth", "third"]);
  rolls.push(1 - Number.EPSILON);
  time = new Date(time.getTime() + 5_000);
  await core.listOrderHistory(session);
  expect(attempts.slice(4)).toEqual(["recent", "first"]);
});

test("clearing an ambiguous order keeps it visible as failed/cleared without redispatch", async () => {
  const store = new MemoryFundingOrderStore();
  let creates = 0;
  let time = new Date("2026-09-12T12:00:00.000Z");
  const core = new FundingCore({ providers: [{ ...provider, onramp: { ...provider.onramp!, async createOrder() { creates++; return { outcome: "ambiguous" }; } } }], store,
    env: { FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "100", verifyReceipt: async () => null, now: () => time });
  const quoted = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
  const order = await core.createOrder(session, { quoteToken: quoted.quoteToken }, "https://home.example");
  expect(creates).toBe(1);
  time = new Date(time.getTime() + AMBIGUOUS_ORDER_RECOVERY_DELAY_MS + 6 * 60_000);
  expect(presentFundingOrder((await core.listOrderHistory(session))[0]!, time, false)).toMatchObject({ status: "ambiguous", stage: "unconfirmed" });
  const before = creates;
  await core.resolveAmbiguousOrder(session, order.id);
  expect(presentFundingOrder((await core.listOrderHistory(session))[0]!, time, false)).toMatchObject({ status: "failed", stage: "cleared" });
  expect(creates).toBe(before);
});
