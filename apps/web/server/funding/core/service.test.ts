import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider, FundingProviderManifest } from "@/shared/funding/provider-contract";
import { MemoryFundingOrderStore } from "./store";
import { FundingCore } from "./service";

const session: VerifiedAccountSession = { user: { subject: "user" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const manifest = { id: "fixture", displayName: "Fixture", docsUrl: "https://example.com", bindings: [{ region: "ID", assetId: "base:idrx", paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"] }], apiOrigins: ["https://example.com"], reference: "home" } as const satisfies FundingProviderManifest;

function setup(outcome: "created" | "ambiguous" = "created") {
  let dispatches = 0;
  let blockReads = 0;
  let observation: "awaiting-payment" | "sent" = "awaiting-payment";
  let date = new Date("2026-09-12T00:00:00.000Z");
  const provider: FundingProvider = {
    manifest,
    async createOrder(input, ctx) {
      dispatches += 1;
      expect(input.destination).toBe(session.smartAccount!.address);
      if (outcome === "ambiguous") return { outcome: "ambiguous" };
      return { outcome: "created", order: { providerOrderId: "fixture-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
    },
    async getOrder() { return { state: observation, providerStatus: observation, transactionHash: observation === "sent" ? `0x${"2".repeat(64)}` : null }; },
  };
  const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => { blockReads += 1; return "500"; }, verifyReceipt: async (_order, hash) => ({ transactionHash: hash, logIndex: 4 }), now: () => date });
  return { core, dispatches: () => dispatches, blockReads: () => blockReads, advance(minutes: number) { date = new Date(date.getTime() + minutes * 60_000); }, sent() { observation = "sent"; date = new Date("2026-09-12T00:00:10.000Z"); } };
}

describe("FundingCore", () => {
  test("binds a quote to the verified destination and dispatches exactly once", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000.00" });
    const first = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    const replay = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(first.id).toBe(replay.id);
    expect(first.quoteToken).toBe(quote.quoteToken);
    expect(replay.quoteToken).toBe(quote.quoteToken);
    expect(fixture.dispatches()).toBe(1);
    expect(fixture.blockReads()).toBe(1);
    expect(first.state).toBe("awaiting-payment");
  });

  test("rejects noncanonical token aliases without a second block read or dispatch", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" });
    await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    await expect(fixture.core.createOrder(session, { quoteToken: `${quote.quoteToken}=` }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fixture.blockReads()).toBe(1);
    expect(fixture.dispatches()).toBe(1);
  });

  test("recovers an existing reservation after token expiry but refuses a new expired intent", async () => {
    const fixture = setup();
    const existingQuote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" });
    const created = await fixture.core.createOrder(session, { quoteToken: existingQuote.quoteToken }, "https://home.example");
    fixture.advance(6);
    const recovered = await fixture.core.createOrder(session, { quoteToken: existingQuote.quoteToken }, "https://home.example");
    expect(recovered.id).toBe(created.id);
    expect(fixture.blockReads()).toBe(1);
    expect(fixture.dispatches()).toBe(1);

    const fresh = setup();
    const expiredNew = await fresh.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" });
    fresh.advance(6);
    await expect(fresh.core.createOrder(session, { quoteToken: expiredNew.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fresh.blockReads()).toBe(0);
    expect(fresh.dispatches()).toBe(0);
  });

  test("never retries an ambiguous create", async () => {
    const fixture = setup("ambiguous");
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" });
    const first = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    const replay = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(first.state).toBe("dispatch-ambiguous"); expect(replay.state).toBe("dispatch-ambiguous"); expect(replay.quoteToken).toBe(quote.quoteToken); expect(fixture.dispatches()).toBe(1);
    expect((await fixture.core.getOpenOrder(session, "ID"))?.id).toBe(first.id);
  });

  test("marks received only after receipt evidence is uniquely claimed", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" });
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    fixture.sent();
    const received = await fixture.core.getOrder(session, created.id);
    expect(received.state).toBe("received");
    expect(received.instructions).toBeNull();
  });

  test("logs unmatched webhooks without raw bodies or provider order identifiers", async () => {
    const events: Array<{ providerId: string; reason: "invalid" | "unmatched" }> = [];
    const provider: FundingProvider = { manifest, createOrder: async () => ({ outcome: "ambiguous" }), getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }), verifyWebhook: () => ({ providerOrderId: "secret-provider-order" }) };
    const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logUnmatchedWebhook: (event) => events.push(event) });
    expect(await core.handleWebhook("fixture", new TextEncoder().encode("private-body"), new Headers())).toEqual({ accepted: true, matched: false });
    expect(events).toEqual([{ providerId: "fixture", reason: "unmatched" }]);
    expect(JSON.stringify(events)).not.toContain("secret-provider-order");
    expect(JSON.stringify(events)).not.toContain("private-body");
  });

  test("rejects a tampered quote before provider dispatch", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" });
    await expect(fixture.core.createOrder(session, { quoteToken: `${quote.quoteToken}x` }, "https://home.example")).rejects.toEqual(expect.objectContaining({ code: "INVALID_QUOTE_TOKEN" }));
    const otherOwner = { ...session, user: { subject: "other-user" } };
    await expect(fixture.core.createOrder(otherOwner, { quoteToken: quote.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fixture.blockReads()).toBe(0);
    expect(fixture.dispatches()).toBe(0);
  });
});
