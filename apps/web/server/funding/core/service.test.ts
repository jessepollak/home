import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readQuoteDraft } from "@/shared/funding/contracts/quotes";
import type {
  FundingProvider,
  FundingProviderManifest,
  OfframpCatalog,
  Instruction,
  Quote,
  QuoteIntent,
} from "@/shared/funding/provider-contract";
import { MemoryFundingOrderStore, type FundingReservation } from "./store";
import {
  ambiguousOrderRecoveryAvailableAt,
  FundingCore,
  resolveClientIp,
  isPrivateIp,
  type FundingOrderTransitionEvent,
  type FundingCoreDependencies,
} from "./service";
import { FundingProviderConfigurationError, resolveFundingMode, resolveWebhookEnvironment } from "./provider-context";
import { FundingQuoteRejectedError } from "./quote-rejection";
import { authenticateFundingQuote } from "./quote-token";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { fundingProviders } from "@/server/funding/providers";
import { euroAreaPeerCountries } from "@/server/funding/providers/peer/manifest";

const session: VerifiedAccountSession = { user: { subject: "user" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const sessionAddress = session.smartAccount?.address;
if (!sessionAddress) throw new Error("fixture session must declare a smart account");
const manifest = { id: "fixture", displayName: "Fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" }, bindings: [{ region: "ID", assetId: "base:idrx", currency: "IDR", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"] } } }] } as const satisfies FundingProviderManifest;
const discoveryCatalog: OfframpCatalog = {
  asOf: "2026-09-12T00:00:00.000Z", maxAgeSeconds: 300,
  platforms: [{ id: "cashapp", label: "Cash App", currencies: ["USD"], handleHint: "Cashtag", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", requiresIdentityAttestation: false, requiresAccessPolicy: false }],
};
function discoveryProvider(id: string, capabilities: NonNullable<FundingProvider["offramp"]>["capabilities"]): FundingProvider {
  return {
    manifest: {
      id, displayName: "Offramp", docsUrl: "https://example.com",
      offramp: { production: { apiOrigins: ["https://off.example"], contracts: { escrow: "0x1111111111111111111111111111111111111111", intentGuardian: "0x2222222222222222222222222222222222222222", intentGatingService: "0x3333333333333333333333333333333333333333" } } },
      bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { offramp: { paymentMethods: [{ id: "cashapp", label: "Cash App" }], env: ["OFFRAMP_ENABLED"], confirmedBy: "fixture" } } }],
    },
    offramp: { capabilities } as NonNullable<FundingProvider["offramp"]>,
  };
}
beforeEach(() => setObservabilityLogWriterForTests(() => undefined));
afterEach(() => setObservabilityLogWriterForTests());

function customerSetup(readOffering?: FundingCoreDependencies["readOffering"], env: Readonly<Record<string, string>> = { FIXTURE_KEY: "set" }) {
  let creates = 0;
  const customerManifest = {
    ...manifest,
    onramp: {
      ...manifest.onramp,
      customer: { handoffOrigins: ["https://verify.example.com"] },
    },
  } as const satisfies FundingProviderManifest;
  const provider: FundingProvider = {
    manifest: customerManifest,
    onramp: {
      customer: {
        async create() {
          creates += 1;
          return { outcome: "created", customerRef: "customer-1" };
        },
        async startVerification() {
          return { outcome: "created", providerUrl: "https://verify.example.com/session?bearer=secret" };
        },
        async getStatus() {
          return "pending";
        },
      },
      async createOrder() { return { outcome: "ambiguous" }; },
      async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
    },
  };
  const core = new FundingCore({
    providers: [provider],
    store: new MemoryFundingOrderStore(),
    env,
    readOffering,
    currentBaseBlock: async () => "1",
    verifyReceipt: async () => null,
  });
  return { core, creates: () => creates };
}

function setup(
  outcome: "created" | "ambiguous" | "rejected" = "created",
  options: { sandbox?: boolean; providerSandbox?: boolean; readOffering?: FundingCoreDependencies["readOffering"] } = {},
) {
  let dispatches = 0;
  let blockReads = 0;
  let receiptVerifications = 0;
  const getOrderSandboxes: boolean[] = [];
  let observation: "awaiting-payment" | "sent" | "unknown" | "failed" | "expired" | "cancelled" | "refunded" = "awaiting-payment";
  let statusThrows = false;
  let date = new Date("2026-09-12T00:00:00.000Z");
  const staleSignals: Array<{ address: string; at: string }> = [];
  const transitionEvents: FundingOrderTransitionEvent[] = [];
  const store = new MemoryFundingOrderStore();
  const provider: FundingProvider = {
    manifest: options.providerSandbox ? { ...manifest, onramp: { ...manifest.onramp, sandbox: true, modeEnv: "FIXTURE_ONRAMP_MODE" } } : manifest,
    onramp: {
      async createOrder(input, ctx) {
      dispatches += 1;
      expect(input.destination).toBe(session.smartAccount!.address);
      if (outcome === "ambiguous") return { outcome: "ambiguous" };
      if (outcome === "rejected") return { outcome: "rejected", message: "fixture rejection" };
      return { outcome: "created", order: { providerOrderId: "fixture-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
    },
      async getOrder(_input, ctx) {
        getOrderSandboxes.push(ctx.sandbox);
        if (statusThrows) throw new Error("fixture status failure");
        return { state: observation, providerStatus: observation, transactionHash: observation === "sent" ? `0x${"2".repeat(64)}` as `0x${string}` : null };
      },
    },
  };
  const core = new FundingCore({ providers: [provider], store, env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32), ...(options.sandbox ? { FIXTURE_ONRAMP_MODE: "sandbox" } : {}) }, readOffering: options.readOffering, currentBaseBlock: async () => { blockReads += 1; return "500"; }, verifyReceipt: async (_order, hash) => { receiptVerifications += 1; return { transactionHash: hash, logIndex: 4 }; }, markStale: async (address, at) => { staleSignals.push({ address, at: at.toISOString() }); }, logOrderTransition: (event) => transitionEvents.push(event), now: () => date });
  return { core, store, transitionEvents, dispatches: () => dispatches, blockReads: () => blockReads, receiptVerifications: () => receiptVerifications, getOrderSandboxes: () => getOrderSandboxes, staleSignals: () => staleSignals, advance(minutes: number) { date = new Date(date.getTime() + minutes * 60_000); }, observe(state: typeof observation) { observation = state; date = new Date(date.getTime() + 10_000); }, throwStatus() { statusThrows = true; date = new Date(date.getTime() + 10_000); }, sent() { observation = "sent"; date = new Date(date.getTime() + 10_000); } };
}

describe("FundingCore", () => {
  test("reads offering once per provider listing and hides paused onramp and offramp corridors", async () => {
    let reads = 0;
    const readOffering = async () => { reads++; return { source: "saved" as const, isSelected: () => false, isOffered: () => false }; };
    const onramp: FundingProvider = { manifest, onramp: {
      createOrder: async () => ({ outcome: "ambiguous" }),
      getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
    } };
    const core = new FundingCore({ providers: [onramp, discoveryProvider("offramp", async () => discoveryCatalog)],
      store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", OFFRAMP_ENABLED: "1" },
      readOffering, currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      now: () => new Date("2026-09-12T00:00:01.000Z") });
    expect(await core.listProviders("ID", session)).toEqual([]);
    expect(await core.listProviders("US", session, "offramp")).toEqual([]);
    expect(reads).toBe(2);
  });

  test("a paused onramp lists only for its owner's open order while blocking new quotes", async () => {
    let offered = true;
    const fixture = setup("created", { readOffering: async () => ({ source: "saved", isSelected: () => offered, isOffered: () => offered }) });
    const originalListOpen = fixture.store.listOpen.bind(fixture.store);
    let openReads = 0;
    fixture.store.listOpen = async (owner, region) => { openReads++; return originalListOpen(owner, region); };
    expect(await fixture.core.listProviders("ID", session)).toHaveLength(1);
    expect(openReads).toBe(0);
    offered = false;
    expect(await fixture.core.listProviders("ID", session)).toEqual([]);
    expect(openReads).toBe(1);
    offered = true;
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const order = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(order.state).toBe("awaiting-payment");
    offered = false;
    expect(await fixture.core.listProviders("ID", session)).toEqual([expect.objectContaining({ providerId: "fixture", region: "ID" })]);
    expect(openReads).toBe(2);
    await expect(fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409 });
    expect(await fixture.core.listProviders("ID", { ...session, user: { subject: "another-user" } })).toEqual([]);
    expect(openReads).toBe(3);
  });

  test("an older paused provider stays listed beside a newer provider, only for the owner of its open order", async () => {
    const older: FundingReservation = {
      id: "11111111-1111-4111-8111-111111111111", owner: { subject: session.user.subject, accountProvider: session.accountProvider },
      destination: sessionAddress, providerId: "fixture", region: "ID", assetId: "base:idrx",
      paymentMethod: "bank", fiatAmount: "20000", intentDigest: "older-intent",
      quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "older-token", customerRef: null, sandbox: false, creationBlock: "1", createdAt: "2026-09-12T00:00:00.000Z",
    };
    const newer = { ...older, id: "22222222-2222-4222-8222-222222222222", providerId: "newer", intentDigest: "newer-intent", createdAt: "2026-09-13T00:00:00.000Z" };
    const store = new MemoryFundingOrderStore();
    await store.reserve(older);
    await store.reserve(newer);
    const provider = (id: string): FundingProvider => ({ manifest: { ...manifest, id }, onramp: {
      createOrder: async () => ({ outcome: "ambiguous" }), getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
    } });
    const core = new FundingCore({ providers: [provider("fixture"), provider("newer")], store, env: { FIXTURE_KEY: "set" },
      readOffering: async () => ({ source: "saved", isSelected: () => true, isOffered: (id) => id === "newer" }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    const listed = await core.listProviders("ID", session);
    expect(listed.map(({ providerId }) => providerId)).toEqual(["fixture", "newer"]);
    expect(listed).toEqual([
      expect.objectContaining({ providerId: "fixture", resumeOnly: true }),
      expect.objectContaining({ providerId: "newer", resumeOnly: false }),
    ]);
    expect(await core.listProviders("ID", { ...session, user: { subject: "someone-else" } })).toEqual([
      expect.objectContaining({ providerId: "newer", resumeOnly: false }),
    ]);
    const pausedWithoutOrder = new FundingCore({ providers: [provider("fixture"), provider("newer")], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set" },
      readOffering: async () => ({ source: "saved", isSelected: () => true, isOffered: (id) => id === "newer" }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    expect((await pausedWithoutOrder.listProviders("ID", session)).map(({ providerId }) => providerId)).toEqual(["newer"]);
  });

  test("only the matching method binding in a paused multi-binding corridor can resume", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve({
      id: "11111111-1111-4111-8111-111111111111", owner: { subject: session.user.subject, accountProvider: session.accountProvider },
      destination: sessionAddress, providerId: "fixture", region: "ID", assetId: "base:idrx", paymentMethod: "bank",
      fiatAmount: "20000", intentDigest: "bank-intent", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "bank-token", customerRef: null, sandbox: false, creationBlock: "1", createdAt: "2026-09-12T00:00:00.000Z",
    });
    const provider: FundingProvider = {
      manifest: { ...manifest, bindings: [...manifest.bindings, {
        region: "ID", assetId: "base:idrx", currency: "IDR", directions: { onramp: {
          paymentMethods: [{ id: "qris", label: "QRIS" }], env: ["FIXTURE_KEY"],
        } },
      }] },
      onramp: { createOrder: async () => ({ outcome: "ambiguous" }), getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }) },
    };
    let offered = false;
    const core = new FundingCore({ providers: [provider], store, env: { FIXTURE_KEY: "set" },
      readOffering: async () => ({ source: "saved", isSelected: () => true, isOffered: () => offered }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    expect(await core.listProviders("ID", session)).toEqual([
      expect.objectContaining({ paymentMethods: [{ id: "bank", label: "Bank" }], resumeOnly: true }),
    ]);
    offered = true;
    expect((await core.listProviders("ID", session)).map((binding) => ({ methods: binding.paymentMethods.map((method) => method.id), resumeOnly: binding.direction === "onramp" && binding.resumeOnly }))).toEqual([
      { methods: ["bank"], resumeOnly: false }, { methods: ["qris"], resumeOnly: false },
    ]);
  });

  test("a paused binding whose asset changed does not advertise an older order as resumable", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve({
      id: "11111111-1111-4111-8111-111111111111", owner: { subject: session.user.subject, accountProvider: session.accountProvider },
      destination: sessionAddress, providerId: "fixture", region: "ID", assetId: "base:idrx", paymentMethod: "bank",
      fiatAmount: "20000", intentDigest: "old-asset-intent", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "old-asset-token", customerRef: null, sandbox: false, creationBlock: "1", createdAt: "2026-09-12T00:00:00.000Z",
    });
    const provider: FundingProvider = {
      manifest: { ...manifest, bindings: [{ region: "ID", assetId: "base:usdc", currency: "USD", directions: { onramp: {
        paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"],
      } } }] },
      onramp: { createOrder: async () => ({ outcome: "ambiguous" }), getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }) },
    };
    const core = new FundingCore({ providers: [provider], store, env: { FIXTURE_KEY: "set" },
      readOffering: async () => ({ source: "saved", isSelected: () => true, isOffered: () => false }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    expect(await core.listProviders("ID", session)).toEqual([]);
  });

  test("a paused onramp lists for the owner of a dispatch-ambiguous order without allowing new quotes", async () => {
    let offered = true;
    const fixture = setup("ambiguous", { readOffering: async () => ({ source: "saved", isSelected: () => offered, isOffered: () => offered }) });
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const order = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(order.state).toBe("dispatch-ambiguous");
    expect((await fixture.store.getOpen({ subject: session.user.subject, accountProvider: session.accountProvider }, "ID"))?.id).toBe(order.id);

    offered = false;
    expect(await fixture.core.listProviders("ID", session)).toEqual([expect.objectContaining({ providerId: "fixture", region: "ID" })]);
    expect(await fixture.core.listProviders("ID", { ...session, user: { subject: "another-user" } })).toEqual([]);
    await expect(fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409 });
  });

  test("a pause rejects new quotes and pre-pause quote orders but preserves an existing order replay", async () => {
    let offered = true;
    let reads = 0;
    const fixture = setup("created", { readOffering: async () => { reads++; return { source: "saved", isSelected: () => offered, isOffered: () => offered }; } });
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    offered = false;
    await expect(fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409, publicMessage: "Fixture is no longer offered here." });
    const pending = setup("created", { readOffering: async () => ({ source: "saved", isSelected: () => false, isOffered: () => false }) });
    await expect(pending.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409 });
    const beforeReplay = reads;
    expect(await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example")).toEqual(created);
    expect(reads).toBe(beforeReplay);
    expect(fixture.dispatches()).toBe(1);
  });

  test("a settings read failure blocks entries but never exits", async () => {
    let broken = false;
    let reads = 0;
    const readOffering = async () => { reads++; if (broken) throw new Error("settings unavailable"); return { source: "saved" as const, isSelected: () => true, isOffered: () => true }; };
    const fixture = setup("ambiguous", { readOffering });
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const order = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    fixture.advance(25 * 60);
    broken = true;
    await expect(fixture.core.listProviders("ID", session)).rejects.toMatchObject({ code: "PROVIDERS_UNAVAILABLE", status: 503 });
    await expect(fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example"))
      .rejects.toMatchObject({ code: "QUOTE_UNAVAILABLE", status: 503 });
    const fresh = setup("created", { readOffering: async () => { throw new Error("settings unavailable"); } });
    await expect(fresh.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example"))
      .rejects.toMatchObject({ code: "ORDER_UNAVAILABLE", status: 503 });
    const beforeExits = reads;
    await fixture.core.getOrder(session, order.id);
    await fixture.core.getOpenOrder(session, "ID");
    await fixture.core.listOrderHistory(session);
    await fixture.core.listProviderCustomers(session, "ID");
    await fixture.core.handleWebhook("fixture", new Uint8Array(), new Headers());
    fixture.advance(24 * 60);
    await fixture.core.resolveAmbiguousOrder(session, order.id);
    expect(reads).toBe(beforeExits);
  });

  test("returns the owner's stored order when a corridor lost its credentials", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    const deconfigured = new FundingCore({
      providers: [{ manifest, onramp: {
        async createOrder() { throw new Error("Must not create while disconnected."); },
        async getOrder() { throw new Error("Must not reach a disconnected provider."); },
      } }],
      store: fixture.store, env: {},
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      now: () => new Date("2026-09-12T00:00:20.000Z"),
    });
    expect(await deconfigured.getOpenOrder(session, "ID")).toMatchObject({ id: created.id, state: "awaiting-payment" });
    expect(await deconfigured.getOrder(session, created.id)).toMatchObject({ id: created.id, state: "awaiting-payment" });
  });

  test("verification start is blocked by a pause or a settings read failure before customer creation", async () => {
    const paused = customerSetup(async () => ({ source: "saved", isSelected: () => false, isOffered: () => false }));
    const input = { providerId: "fixture", region: "ID", email: "alice@example.com" };
    await expect(paused.core.startProviderCustomerVerification(session, input, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409, publicMessage: "Fixture is no longer offered here." });
    expect(paused.creates()).toBe(0);
    const failing = customerSetup(async () => { throw new Error("settings unavailable"); });
    await expect(failing.core.startProviderCustomerVerification(session, input, "https://home.example"))
      .rejects.toMatchObject({ code: "VERIFICATION_UNAVAILABLE", status: 503 });
    expect(failing.creates()).toBe(0);
    let reads = 0;
    const existing = customerSetup(async () => { reads++; if (reads > 1) throw new Error("settings unavailable"); return { source: "saved", isSelected: () => true, isOffered: () => true }; });
    await existing.core.startProviderCustomerVerification(session, input, "https://home.example");
    expect(await existing.core.listProviderCustomers(session, "ID")).toEqual([expect.objectContaining({ state: "pending" })]);
    expect(reads).toBe(1);
    const pausedBrokenMode = customerSetup(async () => ({ source: "saved", isSelected: () => false, isOffered: () => false }), { FIXTURE_KEY: "set", FUNDING_SANDBOX: "" });
    await expect(pausedBrokenMode.core.startProviderCustomerVerification(session, input, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409 });
    expect(pausedBrokenMode.creates()).toBe(0);
  });

  test("a paused corridor refuses a quote before parsing its mode configuration", async () => {
    const core = new FundingCore({
      providers: [{ manifest, onramp: {
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      } }],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FUNDING_SANDBOX: "", FUNDING_QUOTE_SECRET: "s".repeat(32) },
      readOffering: async () => ({ source: "saved", isSelected: () => false, isOffered: () => false }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
    });
    await expect(core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example"))
      .rejects.toMatchObject({ code: "CORRIDOR_NOT_OFFERED", status: 409 });
  });

  test("lists only the bound EUR Revolut cash-out corridor in each euro-area country", async () => {
    const core = new FundingCore({
      providers: fundingProviders,
      store: new MemoryFundingOrderStore(),
      env: {
        PEER_OFFRAMP_ENABLED: "1",
        CDP_API_KEY_ID: "configured", CDP_API_KEY_SECRET: "configured",
        RIPIO_CLIENT_ID_AR: "configured", RIPIO_CLIENT_SECRET_AR: "configured", RIPIO_WEBHOOK_SECRET_AR: "configured",
        RIPIO_CLIENT_ID_BR: "configured", RIPIO_CLIENT_SECRET_BR: "configured", RIPIO_WEBHOOK_SECRET_BR: "configured",
        RIPIO_CLIENT_ID_CO: "configured", RIPIO_CLIENT_SECRET_CO: "configured", RIPIO_WEBHOOK_SECRET_CO: "configured",
        IDRX_CLIENT_ID: "configured", IDRX_CLIENT_SECRET: "configured", IDRX_CUSTOMER_NAME: "configured",
      },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
    });

    for (const region of euroAreaPeerCountries) {
      const offramps = await core.listProviders(region, session, "offramp");
      expect(offramps.map((binding) => ({ providerId: binding.providerId, currency: binding.currency, methods: binding.paymentMethods.map((method) => method.id) }))).toEqual([
        { providerId: "peer", currency: "EUR", methods: ["revolut"] },
      ]);
      expect(await core.listProviders(region, session, "onramp")).toEqual([]);
    }
    for (const [region, currency, methods] of [
      ["US", "USD", ["cashapp", "zelle"]],
      ["GB", "GBP", ["monzo", "revolut"]],
    ] as const) {
      const offramps = await core.listProviders(region, session, "offramp");
      expect(offramps.map((binding) => ({ providerId: binding.providerId, currency: binding.currency, methods: binding.paymentMethods.map((method) => method.id) }))).toEqual([
        { providerId: "peer", currency, methods: [...methods] },
      ]);
    }
    expect(await core.listProviders("AU", session, "offramp")).toEqual([]);
    expect(await core.listProviders("AU", session, "onramp")).toEqual([]);
  });
  test("returns the provider handoff URL only from the explicit verification POST", async () => {
    const { core } = customerSetup();
    const started = await core.startProviderCustomerVerification(
      session,
      { providerId: "fixture", region: "ID", email: "alice@example.com" },
      "https://home.example",
    );

    expect(started).toMatchObject({
      customer: { providerId: "fixture", state: "pending" },
      handoff: { url: "https://verify.example.com/session?bearer=secret" },
    });
    expect(await core.listProviderCustomers(session, "ID")).toEqual([
      expect.objectContaining({ providerId: "fixture", state: "pending" }),
    ]);
    expect(JSON.stringify(await core.listProviderCustomers(session, "ID"))).not.toContain("bearer=secret");
  });

  test("rejects an address over the RFC 5321 limit before reserving a customer row", async () => {
    const { core, creates } = customerSetup();
    const email = `${"a".repeat(250)}@b.co`;

    await expect(core.startProviderCustomerVerification(
      session,
      { providerId: "fixture", region: "ID", email },
      "https://home.example",
    )).rejects.toMatchObject({ code: "INVALID_VERIFICATION_REQUEST", status: 400 });
    expect(creates()).toBe(0);
    expect(await core.listProviderCustomers(session, "ID")).toEqual([]);
  });

  test("scopes sandbox mode to the declaring provider and leaves production providers listed", async () => {
    const sandboxProvider: FundingProvider = {
      manifest: { ...manifest, id: "sandbox-fixture", onramp: { ...manifest.onramp, sandbox: true, modeEnv: "SANDBOX_FIXTURE_MODE" } },
      onramp: {
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const liveProvider: FundingProvider = {
      manifest: { ...manifest, id: "live-fixture" },
      onramp: {
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const dependencies = {
      providers: [sandboxProvider, liveProvider],
      store: new MemoryFundingOrderStore(),
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    };
    const sandboxCore = new FundingCore({
      ...dependencies,
      env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32), SANDBOX_FIXTURE_MODE: "sandbox" },
    });
    const liveCore = new FundingCore({
      ...dependencies,
      env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) },
    });

    expect((await sandboxCore.listProviders("ID", session)).map((item) => item.providerId)).toEqual(["sandbox-fixture", "live-fixture"]);
    expect((await liveCore.listProviders("ID", session)).map((item) => item.providerId)).toEqual(["sandbox-fixture", "live-fixture"]);
  });

  test("rejects legacy and invalid provider mode values", () => {
    expect(() => resolveFundingMode(manifest, "onramp", { FUNDING_SANDBOX: "" }))
      .toThrow("COINBASE_ONRAMP_MODE or PEER_OFFRAMP_MODE");
    const sandboxManifest = { ...manifest, onramp: { ...manifest.onramp, sandbox: true, modeEnv: "FIXTURE_ONRAMP_MODE" } };
    expect(resolveFundingMode(sandboxManifest, "onramp", {})).toBe("production");
    expect(() => resolveFundingMode(sandboxManifest, "onramp", { FIXTURE_ONRAMP_MODE: "1" }))
      .toThrow("must be exactly sandbox");
  });

  test("withholds the offramp corridor and reports hidden discovery failures without request data", async () => {
    const events: Array<{ providerId: string; reason: "configuration" | "provider"; code: string }> = [];
    const provider = discoveryProvider("offramp-fixture", async () => { throw new Error("provider unavailable"); });
    const core = new FundingCore({
      providers: [provider], store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    await expect(core.listProviders("US", session, "offramp")).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(events).toEqual([{
      providerId: "offramp-fixture",
      reason: "provider",
      code: "FUNDING_PROVIDER_CONFIGURATION",
    }]);
  });

  test("keeps an unbound country empty and withholds a stale offramp catalog", async () => {
    const provider: FundingProvider = {
      manifest: {
        id: "offramp-fixture", displayName: "Offramp", docsUrl: "https://example.com",
        offramp: { production: { apiOrigins: ["https://off.example"], contracts: { escrow: "0x1111111111111111111111111111111111111111", intentGuardian: "0x2222222222222222222222222222222222222222", intentGatingService: "0x3333333333333333333333333333333333333333" } } },
        bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { offramp: { paymentMethods: [{ id: "cashapp", label: "Cash App" }], env: ["OFFRAMP_ENABLED"], confirmedBy: "fixture" } } }],
      },
      offramp: {
        capabilities: async () => ({
          platforms: [{
            id: "cashapp", label: "Cash App", currencies: ["USD"], handleHint: "$cashtag",
            minimumAmountAtomic: "1000000", maximumAmountAtomic: null,
            estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed",
            requiresIdentityAttestation: false, requiresAccessPolicy: false,
          }],
          asOf: "2020-01-01T00:00:00.000Z",
          maxAgeSeconds: 60,
        }),
      } as unknown as NonNullable<FundingProvider["offramp"]>,
    };
    const core = new FundingCore({
      providers: [provider], store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
    });
    expect(await core.listProviders("AU", session, "offramp")).toEqual([]);
    await expect(core.listProviders("US", session, "offramp")).rejects.toThrow("PROVIDERS_UNAVAILABLE");
  });

  test("rejects stale offramp discovery and logs a scrubbed provider failure", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const core = new FundingCore({
      providers: [discoveryProvider("stale-fixture", async () => discoveryCatalog)],
      store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      now: () => new Date("2026-09-12T00:06:00.000Z"),
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });

    await expect(core.listProviders("US", session, "offramp")).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(events).toEqual([{ providerId: "stale-fixture", reason: "provider", code: "FUNDING_PROVIDER_CONFIGURATION" }]);
  });

  test("returns a successful offramp binding when another provider discovery fails", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const core = new FundingCore({
      providers: [
        discoveryProvider("down-fixture", async () => { throw new Error("provider unavailable"); }),
        discoveryProvider("working-fixture", async () => discoveryCatalog),
      ],
      store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      now: () => new Date("2026-09-12T00:01:00.000Z"),
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });

    expect(await core.listProviders("US", session, "offramp")).toEqual([
      expect.objectContaining({ providerId: "working-fixture", region: "US", paymentMethods: [expect.objectContaining({ platform: "cashapp" })] }),
    ]);
    expect(events).toEqual([{ providerId: "down-fixture", reason: "provider", code: "FUNDING_PROVIDER_CONFIGURATION" }]);
  });

  test("withholds a bound offramp corridor whose provider configuration fails", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const core = new FundingCore({
      providers: [discoveryProvider("unconfigured-fixture", async () => { throw new FundingProviderConfigurationError("missing configuration"); })],
      store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });

    await expect(core.listProviders("US", session, "offramp")).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(events).toEqual([{ providerId: "unconfigured-fixture", reason: "configuration", code: "FUNDING_PROVIDER_CONFIGURATION" }]);
  });

  test("fails discovery closed and reports the scrubbed legacy sandbox migration code", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const core = new FundingCore({
      providers: [{
        manifest,
        onramp: {
          async createOrder() { return { outcome: "ambiguous" }; },
          async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
        },
      }],
      store: new MemoryFundingOrderStore(),
      env: { FUNDING_SANDBOX: "", FIXTURE_KEY: "secret-value" },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });

    await expect(core.listProviders("ID", session)).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(events).toEqual([{
      providerId: "fixture",
      reason: "configuration",
      code: "FUNDING_SANDBOX_MIGRATION_REQUIRED",
    }]);
    expect(JSON.stringify(events)).not.toContain("secret-value");
  });

  test("omits a saved-off disconnected corridor silently but reports deployment credential failure", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    let source: "saved" | "deployment" = "saved";
    const core = new FundingCore({
      providers: [{ manifest, onramp: {
        createOrder: async () => ({ outcome: "ambiguous" }),
        getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
      } }],
      store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "" },
      readOffering: async () => ({ source, isSelected: () => false, isOffered: () => false }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    expect(await core.listProviders("ID", session)).toEqual([]);
    expect(events).toEqual([]);
    source = "deployment";
    await expect(core.listProviders("ID", session)).rejects.toMatchObject({ code: "PROVIDERS_UNAVAILABLE", status: 503 });
    expect(events).toEqual([{ providerId: "fixture", reason: "configuration", code: "FUNDING_BINDING_ENVIRONMENT_MISSING" }]);
  });

  test("a saved-off connected corridor is omitted before its mode configuration is parsed", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    let offered = true;
    const core = new FundingCore({
      providers: [{ manifest, onramp: {
        createOrder: async () => ({ outcome: "ambiguous" }),
        getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
      } }],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FUNDING_SANDBOX: "" },
      readOffering: async () => ({ source: "saved", isSelected: () => offered, isOffered: () => offered }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    offered = false;
    expect(await core.listProviders("ID", session)).toEqual([]);
    expect(events).toEqual([]);
    offered = true;
    await expect(core.listProviders("ID", session)).rejects.toMatchObject({ code: "PROVIDERS_UNAVAILABLE", status: 503 });
    expect(events).toEqual([{ providerId: "fixture", reason: "configuration", code: "FUNDING_SANDBOX_MIGRATION_REQUIRED" }]);
  });

  test("a paused provider's unusable mode value leaves an offered provider listed", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const modeManifest = { ...manifest, onramp: { ...manifest.onramp, modeEnv: "FIXTURE_ONRAMP_MODE" } } as const satisfies FundingProviderManifest;
    const provider = (id: string, value: FundingProviderManifest = manifest): FundingProvider => ({ manifest: { ...value, id }, onramp: {
      createOrder: async () => ({ outcome: "ambiguous" }),
      getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
    } });
    const core = new FundingCore({
      providers: [provider("fixture", modeManifest), provider("newer")],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FIXTURE_ONRAMP_MODE: "production" },
      readOffering: async () => ({ source: "saved", isSelected: (id) => id === "newer", isOffered: (id) => id === "newer" }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    expect((await core.listProviders("ID", session)).map((binding) => binding.providerId)).toEqual(["newer"]);
    expect(events).toEqual([]);
  });

  test("a resumable paused corridor still fails closed on an unusable mode value", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const store = new MemoryFundingOrderStore();
    await store.reserve({
      id: "11111111-1111-4111-8111-111111111111", owner: { subject: session.user.subject, accountProvider: session.accountProvider },
      destination: sessionAddress, providerId: "fixture", region: "ID", assetId: "base:idrx",
      paymentMethod: "bank", fiatAmount: "20000", intentDigest: "resumable-mode-intent",
      quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "resumable-mode-token", customerRef: null, sandbox: false, creationBlock: "1", createdAt: "2026-09-12T00:00:00.000Z",
    });
    const core = new FundingCore({
      providers: [{ manifest, onramp: {
        createOrder: async () => ({ outcome: "ambiguous" }),
        getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
      } }],
      store, env: { FIXTURE_KEY: "set", FUNDING_SANDBOX: "" },
      readOffering: async () => ({ source: "saved", isSelected: () => false, isOffered: () => false }),
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    await expect(core.listProviders("ID", session)).rejects.toMatchObject({ code: "PROVIDERS_UNAVAILABLE", status: 503 });
    expect(events).toEqual([{ providerId: "fixture", reason: "configuration", code: "FUNDING_SANDBOX_MIGRATION_REQUIRED" }]);
  });

  test("withholds a matched corridor whose binding environment is missing and stays quiet for other regions", async () => {
    const events: Array<{ providerId: string; reason: string; code: string }> = [];
    const core = new FundingCore({
      providers: [{
        manifest,
        onramp: {
          async createOrder() { return { outcome: "ambiguous" }; },
          async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
        },
      }],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "" },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });

    await expect(core.listProviders("ID", session)).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(events).toEqual([{
      providerId: "fixture",
      reason: "configuration",
      code: "FUNDING_BINDING_ENVIRONMENT_MISSING",
    }]);
    expect(JSON.stringify(events)).not.toContain("FIXTURE_KEY");

    // A binding for another region is simply not listed; it is not a
    // configuration failure and must stay quiet.
    events.length = 0;
    expect(await core.listProviders("US", session)).toEqual([]);
    expect(events).toEqual([]);
  });

  test("rejects Coinbase-like minimum amounts before calling the provider and quotes larger amounts", async () => {
    let calls = 0;
    let fetches = 0;
    const quoteManifest = {
      id: "coinbase-fixture", displayName: "Coinbase", docsUrl: "https://example.com",
      onramp: { apiOrigins: ["https://example.com"], reference: "provider" as const, quotes: true },
      bindings: [{ region: "US" as const, assetId: "base:usdc", currency: "USD" as const, directions: {
        onramp: { paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], env: ["FIXTURE_KEY"], minimumFiatAmount: "2.00" },
      } }],
    } satisfies FundingProviderManifest;
    const core = new FundingCore({
      providers: [{ manifest: quoteManifest, onramp: {
        async createQuote(input) { calls += 1; return { providerQuoteId: "provider-quote", fiatAmount: input.fiatAmount, tokenAmountAtomic: "2020000", fees: [{ label: "Network", amount: "0.01", currency: "USD" }], feesKnown: true, expiresAt: "2099-01-01T00:00:00.000Z" }; },
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      } }],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", ["FUNDING_" + "QUOTE_SECRET"]: "q".repeat(32) },
      fetchImplementation: (async () => { fetches += 1; throw new Error("unexpected fetch"); }) as unknown as typeof fetch,
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
    });
    const request = (fiatAmount: string) => core.createQuote(session,
      { providerId: "coinbase-fixture", region: "US", paymentMethod: "apple-pay", fiatAmount }, "https://home.example");
    for (const amount of ["2", "0.10"]) {
      await expect(request(amount)).rejects.toMatchObject({ code: "QUOTE_BELOW_MINIMUM", status: 422,
        publicMessage: "Coinbase needs more than $2 after fees. Enter a larger amount." });
    }
    expect(calls).toBe(0);
    expect(fetches).toBe(0);
    const response = JSON.parse(JSON.stringify(await request("2.07")));
    const draft = readQuoteDraft(response);
    expect(draft).not.toBeNull();
    expect(response.version).toBe(1);
    expect(draft?.version).toBe(1);
    expect(draft?.quote).toMatchObject({
      fiatAmount: "2.07", providerQuoteId: "provider-quote", feesKnown: true,
      fees: [{ label: "Network", amount: "0.01", currency: "USD" }],
    });
    expect(calls).toBe(1);
  });

  test("rejects a provider quote outside the contract before signing and strips undeclared fields", async () => {
    const base = {
      providerQuoteId: "provider-quote",
      fiatAmount: "2.07",
      tokenAmountAtomic: "2020000",
      fees: [{ label: "Network", amount: "0.01", currency: "USD" }],
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const returned: { value: unknown } = { value: base };
    let calls = 0;
    const quoteManifest: FundingProviderManifest = {
      id: "coinbase-fixture", displayName: "Coinbase", docsUrl: "https://example.com",
      onramp: { apiOrigins: ["https://example.com"], reference: "provider", quotes: true },
      bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: {
        paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], env: ["FIXTURE_KEY"],
      } } }],
    };
    const core = new FundingCore({
      providers: [{ manifest: quoteManifest, onramp: {
        async createQuote() { calls += 1; return returned.value as Quote; },
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      } }],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", ["FUNDING_" + "QUOTE_SECRET"]: "q".repeat(32) },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
    });
    const request = () => core.createQuote(session,
      { providerId: "coinbase-fixture", region: "US", paymentMethod: "apple-pay", fiatAmount: "2.07" }, "https://home.example");

    for (const [_label, value] of [
      ["fee missing currency", { ...base, fees: [{ label: "Network", amount: "0.01" }] }],
      ["non-string fee currency", { ...base, fees: [{ label: "Network", amount: "0.01", currency: 1 }] }],
      ["non-string providerQuoteId", { ...base, providerQuoteId: 5 }],
      ["non-boolean feesKnown", { ...base, feesKnown: "true" }],
      ["null quote", null],
      ["unparseable expiry", { ...base, expiresAt: "not-a-date" }],
      ["expired quote", { ...base, expiresAt: "2000-01-01T00:00:00.000Z" }],
      ["mismatched fiat amount", { ...base, fiatAmount: "3.00" }],
      ["non-atomic token amount", { ...base, tokenAmountAtomic: "2.020000" }],
    ] as const) {
      returned.value = value;
      const rejected = request();
      await expect(rejected).rejects.toMatchObject({ code: "INVALID_PROVIDER_QUOTE", status: 502 });
      await expect(rejected).rejects.not.toHaveProperty("quoteToken");
    }

    returned.value = { ...base, undeclared: "ignored" };
    const draft = await request();
    expect(draft).toEqual({
      version: 1,
      quote: base,
      quoteToken: expect.any(String),
      sandbox: false,
    });
    expect(draft.quote).not.toHaveProperty("undeclared");
    const authenticated = authenticateFundingQuote(draft.quoteToken, "q".repeat(32));
    expect(authenticated?.claims.quote).toEqual(draft.quote);
    expect(calls).toBe(10);
  });

  test("maps typed provider quote rejections to public copy without provider text", async () => {
    for (const [reason, minimum, code, publicMessage] of [
      ["below-minimum", "2", "QUOTE_BELOW_MINIMUM", "Coinbase needs more than $2 after fees. Enter a larger amount."],
      ["below-minimum", undefined, "QUOTE_BELOW_MINIMUM", "This amount is below Coinbase's minimum. Enter a larger amount."],
      ["declined", "2", "QUOTE_DECLINED", "Coinbase couldn't quote this amount. Try a different amount."],
    ] as const) {
      const quoteManifest: FundingProviderManifest = {
        id: "coinbase-fixture", displayName: "Coinbase", docsUrl: "https://example.com",
        onramp: { apiOrigins: ["https://example.com"], reference: "provider", quotes: true },
        bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: {
          paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], env: ["FIXTURE_KEY"], minimumFiatAmount: minimum,
        } } }],
      };
      const core = new FundingCore({
        providers: [{ manifest: quoteManifest, onramp: {
          async createQuote() { throw new FundingQuoteRejectedError(reason); },
          async createOrder() { return { outcome: "ambiguous" }; },
          async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
        } }],
        store: new MemoryFundingOrderStore(),
        env: { FIXTURE_KEY: "set", ["FUNDING_" + "QUOTE_SECRET"]: "q".repeat(32) },
        currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      });
      await expect(core.createQuote(session, { providerId: "coinbase-fixture", region: "US", paymentMethod: "apple-pay", fiatAmount: "2.07" }, "https://home.example"))
        .rejects.toMatchObject({ code, status: 422, publicMessage });
    }
  });

  test("rejects quote tokens when the core sandbox mode changes", async () => {
    const sandbox = setup("created", { sandbox: true, providerSandbox: true });
    const sandboxQuote = await sandbox.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    expect(sandboxQuote.sandbox).toBe(true);

    const live = setup("created", { providerSandbox: true });
    await expect(live.core.createOrder(session, { quoteToken: sandboxQuote.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(live.blockReads()).toBe(0);
    expect(live.dispatches()).toBe(0);

    const liveQuote = await live.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example");
    await expect(sandbox.core.createOrder(session, { quoteToken: liveQuote.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(sandbox.blockReads()).toBe(0);
    expect(sandbox.dispatches()).toBe(0);
  });

  test("rejects sandbox quotes for providers that do not declare sandbox support", async () => {
    let providerCalls = 0;
    const provider: FundingProvider = {
      manifest: { ...manifest, onramp: { ...manifest.onramp, quotes: true, modeEnv: "FIXTURE_ONRAMP_MODE" } },
      onramp: {
        async createQuote() { providerCalls += 1; throw new Error("unexpected provider call"); },
        async createOrder() { providerCalls += 1; return { outcome: "ambiguous" }; },
        async getOrder() { providerCalls += 1; return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const core = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FIXTURE_ONRAMP_MODE: "sandbox", ["FUNDING_" + "QUOTE_SECRET"]: "q".repeat(32) },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });

    await expect(core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example")).rejects.toThrow("does not declare sandbox support");
    expect(providerCalls).toBe(0);
  });

  test("refresh uses the persisted order sandbox mode in the provider context", async () => {
    for (const sandbox of [false, true]) {
      const fixture = setup("created", { sandbox, providerSandbox: sandbox });
      const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
      const order = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      fixture.advance(1);
      await fixture.core.getOrder(session, order.id);
      expect(fixture.getOrderSandboxes()).toEqual([sandbox]);
    }
  });

  test("exposes sandbox orders and never verifies receipts for them", async () => {
    const fixture = setup("created", { sandbox: true, providerSandbox: true });
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(created.sandbox).toBe(true);
    fixture.sent();
    const completed = await fixture.core.getOrder(session, created.id);
    expect(completed).toMatchObject({ sandbox: true, state: "sent-unverified" });
    expect(fixture.receiptVerifications()).toBe(0);
  });

  test("passes the first forwarded client IP hop to the provider without persisting it", async () => {
    let capturedClientIp: string | undefined;
    const provider: FundingProvider = {
      manifest,
      onramp: {
        async createOrder(input, ctx) {
          capturedClientIp = input.clientIp;
          return { outcome: "created", order: { providerOrderId: "fixture-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
        },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const core = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });
    const quote = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const order = await core.createOrder(
      session,
      { quoteToken: quote.quoteToken },
      "https://home.example",
      new Headers({ "x-forwarded-for": " 203.0.113.4, 10.0.0.2 ", "x-real-ip": "198.51.100.7" }),
    );
    expect(capturedClientIp).toBe("203.0.113.4");
    expect(order).not.toHaveProperty("clientIp");
  });

  test("binds a quote to the verified destination and dispatches exactly once", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000.00" }, "https://home.example");
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
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    await expect(fixture.core.createOrder(session, { quoteToken: `${quote.quoteToken}=` }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fixture.blockReads()).toBe(1);
    expect(fixture.dispatches()).toBe(1);
  });

  test("recovers an existing reservation after token expiry but refuses a new expired intent", async () => {
    const fixture = setup();
    const existingQuote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: existingQuote.quoteToken }, "https://home.example");
    fixture.advance(6);
    const recovered = await fixture.core.createOrder(session, { quoteToken: existingQuote.quoteToken }, "https://home.example");
    expect(recovered.id).toBe(created.id);
    expect(fixture.blockReads()).toBe(1);
    expect(fixture.dispatches()).toBe(1);

    const fresh = setup();
    const expiredNew = await fresh.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example");
    fresh.advance(6);
    await expect(fresh.core.createOrder(session, { quoteToken: expiredNew.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fresh.blockReads()).toBe(0);
    expect(fresh.dispatches()).toBe(0);
  });

  test("never retries an ambiguous create", async () => {
    const fixture = setup("ambiguous");
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const first = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    const replay = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(first.state).toBe("dispatch-ambiguous"); expect(replay.state).toBe("dispatch-ambiguous"); expect(replay.quoteToken).toBe(quote.quoteToken); expect(fixture.dispatches()).toBe(1);
    expect((await fixture.core.getOpenOrder(session, "ID"))?.id).toBe(first.id);
  });

  test("fails recovery closed for invalid and overflowing boundaries", () => {
    const quote = { fiatAmount: "1", tokenAmountAtomic: "1", fees: [], expiresAt: "invalid" };
    expect(ambiguousOrderRecoveryAvailableAt({
      updatedAt: "2026-09-12T00:00:00.000Z",
      quote,
    }).toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(() => ambiguousOrderRecoveryAvailableAt({
      updatedAt: "invalid",
      quote: { ...quote, expiresAt: "2026-09-12T00:05:00.000Z" },
    })).toThrow("ORDER_RECOVERY_TIME_INVALID");
    expect(() => ambiguousOrderRecoveryAvailableAt({
      updatedAt: "2026-09-12T00:00:00.000Z",
      quote: { ...quote, expiresAt: "+275760-09-13T00:00:00.000Z" },
    })).toThrow("ORDER_RECOVERY_TIME_INVALID");
  });

  test("owner recovery waits 24 hours, unblocks the region, and never calls the provider", async () => {
    const fixture = setup("ambiguous");
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const ambiguous = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");

    const wrongOwner = { ...session, user: { subject: "other-user" } };
    await expect(fixture.core.resolveAmbiguousOrder(wrongOwner, ambiguous.id))
      .rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(fixture.core.resolveAmbiguousOrder(session, ambiguous.id))
      .rejects.toMatchObject({
        code: "ORDER_RESOLUTION_NOT_READY",
        availableAt: "2026-09-13T00:05:00.000Z",
      });
    expect(await fixture.core.getOpenOrder(session, "ID")).toMatchObject({
      id: ambiguous.id,
      state: "dispatch-ambiguous",
      updatedAt: ambiguous.updatedAt,
    });

    const anotherQuote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "21000" }, "https://home.example");
    await expect(fixture.core.createOrder(session, { quoteToken: anotherQuote.quoteToken }, "https://home.example"))
      .rejects.toMatchObject({ code: "AMBIGUOUS_ORDER_OPEN" });
    expect(fixture.dispatches()).toBe(1);
    expect(fixture.blockReads()).toBe(1);
    expect(fixture.getOrderSandboxes()).toHaveLength(0);

    fixture.advance(24 * 60 + 6);
    const resolved = await fixture.core.resolveAmbiguousOrder(session, ambiguous.id);
    expect(resolved.state).toBe("cancelled");
    expect(fixture.dispatches()).toBe(1);
    expect(fixture.getOrderSandboxes()).toHaveLength(0);
    expect(await fixture.core.getOpenOrder(session, "ID")).toBeNull();
    expect(fixture.transitionEvents.map((event) => event.code)).toEqual(["ORDER_AMBIGUOUS", "ORDER_AMBIGUOUS_RESOLVED"]);
    expect(fixture.transitionEvents.at(-1)).toEqual(expect.objectContaining({ route: "/api/funding/orders/:id/resolve", outcome: "ok", region: "ID" }));
    await expect(fixture.core.resolveAmbiguousOrder(session, ambiguous.id))
      .rejects.toMatchObject({ code: "ORDER_NOT_AMBIGUOUS" });
    expect(fixture.transitionEvents).toHaveLength(2);
  });

  test("an ambiguous order from a deconfigured provider does not lock the region's other providers", async () => {
    const fixture = setup();
    const owner = { subject: session.user.subject, accountProvider: session.accountProvider };
    const retired = await fixture.store.reserve({
      id: "77777777-7777-4777-8777-777777777777", owner, destination: session.smartAccount!.address,
      providerId: "retired", region: "ID", assetId: "base:idrx", paymentMethod: "bank", fiatAmount: "20000",
      intentDigest: "retired-intent", quote: { fiatAmount: "20000", tokenAmountAtomic: "1", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "retired-token", customerRef: null, sandbox: false, creationBlock: "1", createdAt: "2026-09-11T00:00:00.000Z",
    });
    await fixture.store.markDispatchAmbiguous(retired.order.id, retired.order.version, "2026-09-11T00:00:01.000Z");

    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(created).toMatchObject({ providerId: "fixture", state: "awaiting-payment" });
    expect(fixture.dispatches()).toBe(1);
    expect((await fixture.store.getOwned(retired.order.id, owner))?.state).toBe("dispatch-ambiguous");
  });

  test("marks received only after receipt evidence is uniquely claimed", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    fixture.sent();
    const received = await fixture.core.getOrder(session, created.id);
    expect(received.state).toBe("received");
    expect(received.instructions).toBeNull();
    expect(fixture.staleSignals()).toEqual([{
      address: session.smartAccount!.address,
      at: "2026-09-12T00:00:10.000Z",
    }]);
  });

  test("emits lifecycle outcomes only after successful state changes", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(fixture.transitionEvents).toEqual([expect.objectContaining({
      code: "ORDER_CREATED", outcome: "ok", providerId: "fixture", region: "ID", sandbox: false,
    })]);

    fixture.advance(1);
    await fixture.core.getOrder(session, created.id);
    expect(fixture.transitionEvents.map((event) => event.code)).toEqual(["ORDER_CREATED"]);

    fixture.sent();
    await fixture.core.getOrder(session, created.id);
    expect(fixture.transitionEvents.map((event) => event.code)).toEqual([
      "ORDER_CREATED", "ORDER_SENT_UNVERIFIED", "ORDER_RECEIVED",
    ]);
    await fixture.core.getOrder(session, created.id);
    expect(fixture.transitionEvents).toHaveLength(3);
  });

  test("emits create rejection and ambiguity once, including the core echo safety rejection", async () => {
    for (const [outcome, code] of [["rejected", "ORDER_REJECTED"], ["ambiguous", "ORDER_AMBIGUOUS"]] as const) {
      const fixture = setup(outcome);
      const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
      await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      expect(fixture.transitionEvents.map((event) => event.code)).toEqual([code]);
    }

    const events: FundingOrderTransitionEvent[] = [];
    const core = coreWithInstruction(
      { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: "20000", currency: "IDR" },
      "1999999",
      events,
    );
    const quote = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(events.map((event) => event.code)).toEqual(["ORDER_AMBIGUOUS"]);
  });

  test("does not emit on unknown or thrown refreshes or a lost observation CAS", async () => {
    for (const mode of ["unknown", "throw", "cas"] as const) {
      const fixture = setup();
      const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
      const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      if (mode === "throw") fixture.throwStatus();
      else fixture.observe(mode === "unknown" ? "unknown" : "failed");
      if (mode === "cas") fixture.store.applyObservation = async () => null;
      await fixture.core.getOrder(session, created.id);
      expect(fixture.transitionEvents.map((event) => event.code), mode).toEqual(["ORDER_CREATED"]);
    }
  });

  test.each([
    ["failed", "ORDER_FAILED"],
    ["expired", "ORDER_EXPIRED"],
    ["cancelled", "ORDER_CANCELLED"],
    ["refunded", "ORDER_REFUNDED"],
  ] as const)("maps terminal provider state %s to %s", async (state, code) => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await fixture.core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    fixture.observe(state);
    await fixture.core.getOrder(session, created.id);
    expect(fixture.transitionEvents.at(-1)).toEqual(expect.objectContaining({ code, outcome: "failed" }));
  });

  test("binds webhook signatures to the order region while preserving shared-secret manifests", async () => {
    const run = async (webhookEnv: string | { US: string; ID: string }, signature: string, removeOrderRegionSecret = false) => {
      let refreshes = 0;
      const matchedEvents: Array<{ providerId: string; region: string }> = [];
      const transitionEvents: FundingOrderTransitionEvent[] = [];
      const store = new MemoryFundingOrderStore();
      const bindings = [
        { region: "US" as const, assetId: "base:usdc", currency: "USD" as const, directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: [typeof webhookEnv === "string" ? webhookEnv : webhookEnv.US] } } },
        { region: "ID" as const, assetId: "base:idrx", currency: "IDR" as const, directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: [typeof webhookEnv === "string" ? webhookEnv : webhookEnv.ID] } } },
      ];
      const regionalManifest = { id: "regional", displayName: "Regional", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" as const, webhook: { signatureHeader: "x-signature", env: webhookEnv } }, bindings } satisfies FundingProviderManifest;
      const provider: FundingProvider = { manifest: regionalManifest, onramp: {
        async createOrder(input, ctx) { return { outcome: "created", order: { providerOrderId: "regional-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "1", amount: input.fiatAmount, currency: ctx.binding.currency } } }; },
        async getOrder() { refreshes += 1; return { state: "awaiting-payment", providerStatus: "pending" }; },
        verifyWebhook(_raw, headers, ctx) { const name = resolveWebhookEnvironment(regionalManifest.onramp.webhook, ctx.binding.region); return name && ctx.env[name] === headers.get("x-signature") ? { providerOrderId: "regional-order" } : null; },
      } };
      const quoteSecretName = "FUNDING_" + "QUOTE_SECRET";
      const usSecretName = typeof webhookEnv === "string" ? webhookEnv : webhookEnv.US;
      const idSecretName = typeof webhookEnv === "string" ? webhookEnv : webhookEnv.ID;
      const fullEnv = { [quoteSecretName]: "q".repeat(32), [usSecretName]: "us-secret", [idSecretName]: typeof webhookEnv === "string" ? "us-secret" : "id-secret" };
      const creatingCore = new FundingCore({ providers: [provider], store, env: fullEnv, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
      const quote = await creatingCore.createQuote(session, { providerId: "regional", region: "ID", paymentMethod: "bank", fiatAmount: "1000" }, "https://home.example");
      await creatingCore.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      const runtimeEnv = removeOrderRegionSecret && typeof webhookEnv !== "string"
        ? { [quoteSecretName]: "q".repeat(32), [webhookEnv.US]: "us-secret" }
        : fullEnv;
      const core = new FundingCore({ providers: [provider], store, env: runtimeEnv, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logMatchedWebhook: (event) => matchedEvents.push(event), logOrderTransition: (event) => transitionEvents.push(event) });
      const result = await core.handleWebhook("regional", new Uint8Array(), new Headers({ "x-signature": signature }));
      return { result, refreshes, matchedEvents, transitionEvents };
    };

    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "id-secret")).toEqual({ result: { accepted: true, matched: true }, refreshes: 1, matchedEvents: [{ providerId: "regional", region: "ID" }], transitionEvents: [] });
    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "us-secret")).toEqual({ result: { accepted: true, matched: false }, refreshes: 0, matchedEvents: [], transitionEvents: [] });
    expect(await run("SHARED_HOOK", "us-secret")).toEqual({ result: { accepted: true, matched: true }, refreshes: 1, matchedEvents: [{ providerId: "regional", region: "ID" }], transitionEvents: [] });
    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "us-secret", true)).toEqual({ result: { accepted: true, matched: false }, refreshes: 0, matchedEvents: [], transitionEvents: [] });
  });

  test("propagates unexpected webhook verification errors while treating missing binding configuration as invalid", async () => {
    const unexpected = new Error("adapter bug");
    const throwingProvider: FundingProvider = {
      manifest,
      onramp: {
        createOrder: async () => ({ outcome: "ambiguous" }),
        getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }),
        verifyWebhook: () => { throw unexpected; },
      },
    };
    const configured = new FundingCore({ providers: [throwingProvider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set" }, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    await expect(configured.handleWebhook("fixture", new Uint8Array(), new Headers())).rejects.toBe(unexpected);

    const events: Array<{ providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }> = [];
    const missingConfig = new FundingCore({ providers: [throwingProvider], store: new MemoryFundingOrderStore(), env: {}, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logUnmatchedWebhook: (event) => events.push(event) });
    expect(await missingConfig.handleWebhook("fixture", new Uint8Array(), new Headers())).toEqual({ accepted: true, matched: false });
    expect(events).toEqual([{ providerId: "fixture", reason: "invalid" }]);

    throwingProvider.onramp!.verifyWebhook = () => { throw new FundingProviderConfigurationError("missing webhook secret"); };
    const configurationMiss = new FundingCore({ providers: [throwingProvider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set" }, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logUnmatchedWebhook: (event) => events.push(event) });
    expect(await configurationMiss.handleWebhook("fixture", new Uint8Array(), new Headers())).toEqual({ accepted: true, matched: false });
    expect(events.at(-1)).toEqual({ providerId: "fixture", reason: "invalid" });
  });

  test("logs a scrubbed region mismatch and propagates unexpected cross-region verification errors", async () => {
    const store = new MemoryFundingOrderStore();
    const bindings = [
      { region: "US" as const, assetId: "base:usdc", currency: "USD" as const, directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["US_HOOK"] } } },
      { region: "ID" as const, assetId: "base:idrx", currency: "IDR" as const, directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["ID_HOOK"] } } },
    ];
    const regionalManifest = { id: "regional", displayName: "Regional", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" as const, webhook: { signatureHeader: "x-signature", env: { US: "US_HOOK", ID: "ID_HOOK" } } }, bindings } satisfies FundingProviderManifest;
    let orderRegionError: Error | null = null;
    const unexpected = new Error("cross-region adapter bug");
    const provider: FundingProvider = { manifest: regionalManifest, onramp: {
      async createOrder(input, ctx) { return { outcome: "created", order: { providerOrderId: "private-regional-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "1", amount: input.fiatAmount, currency: ctx.binding.currency } } }; },
      async getOrder() { return { state: "awaiting-payment", providerStatus: "pending" }; },
      verifyWebhook(_raw, headers, ctx) {
        if (ctx.binding.region === "ID" && orderRegionError) throw orderRegionError;
        const name = resolveWebhookEnvironment(regionalManifest.onramp.webhook, ctx.binding.region);
        return name && ctx.env[name] === headers.get("x-signature") ? { providerOrderId: "private-regional-order" } : null;
      },
    } };
    const quoteSecretName = "FUNDING_" + "QUOTE_SECRET";
    const env = { [quoteSecretName]: "q".repeat(32), US_HOOK: "us-secret", ID_HOOK: "id-secret" };
    const creatingCore = new FundingCore({ providers: [provider], store, env, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    const quote = await creatingCore.createQuote(session, { providerId: "regional", region: "ID", paymentMethod: "bank", fiatAmount: "1000" }, "https://home.example");
    await creatingCore.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");

    const events: Array<{ providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }> = [];
    const matchedEvents: Array<{ providerId: string; region: string }> = [];
    const core = new FundingCore({ providers: [provider], store, env, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logUnmatchedWebhook: (event) => events.push(event), logMatchedWebhook: (event) => matchedEvents.push(event) });
    const raw = new TextEncoder().encode("private-body");
    expect(await core.handleWebhook("regional", raw, new Headers({ "x-signature": "us-secret" }))).toEqual({ accepted: true, matched: false });
    expect(events).toEqual([{ providerId: "regional", reason: "region-mismatch" }]);
    expect(JSON.stringify(events)).not.toContain("private-regional-order");
    expect(JSON.stringify(events)).not.toContain("private-body");
    expect(await core.handleWebhook("regional", raw, new Headers({ "x-signature": "id-secret" }))).toEqual({ accepted: true, matched: true });
    expect(matchedEvents).toEqual([{ providerId: "regional", region: "ID" }]);
    expect(JSON.stringify(matchedEvents)).not.toContain("private-regional-order");
    expect(JSON.stringify(matchedEvents)).not.toContain("private-body");

    orderRegionError = new FundingProviderConfigurationError("missing binding configuration");
    expect(await core.handleWebhook("regional", raw, new Headers({ "x-signature": "us-secret" }))).toEqual({ accepted: true, matched: false });
    expect(events.at(-1)).toEqual({ providerId: "regional", reason: "region-mismatch" });

    orderRegionError = unexpected;
    await expect(core.handleWebhook("regional", raw, new Headers({ "x-signature": "us-secret" }))).rejects.toBe(unexpected);
  });

  test("treats cross-region provider context configuration failures as unmatched", async () => {
    const store = new MemoryFundingOrderStore();
    const provider: FundingProvider = {
      manifest: {
        id: "regional-context", displayName: "Regional context", docsUrl: "https://example.com",
        onramp: { apiOrigins: ["https://example.com"], reference: "home", webhook: { signatureHeader: "x-signature", env: { US: "US_HOOK", ID: "ID_HOOK" } } },
        bindings: [
          { region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["US_HOOK"] } } },
          { region: "ID", assetId: "missing-asset", currency: "IDR", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["ID_HOOK"] } } },
        ],
      },
      onramp: {
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
        verifyWebhook(_raw, headers, ctx) {
          return ctx.binding.region === "US" && headers.get("x-signature") === "us-secret"
            ? { providerOrderId: "regional-context-order" }
            : null;
        },
      },
    };
    const reserved = await store.reserve({
      id: "regional-context-home-order",
      owner: { subject: session.user.subject, accountProvider: session.accountProvider },
      destination: session.smartAccount!.address,
      providerId: "regional-context",
      region: "ID",
      assetId: "missing-asset",
      paymentMethod: "bank",
      fiatAmount: "1000",
      intentDigest: "regional-context-intent",
      quote: { fiatAmount: "1000", tokenAmountAtomic: "100000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      quoteToken: "regional-context-token",
      customerRef: null,
      sandbox: false,
      creationBlock: "1",
      createdAt: "2026-09-12T00:00:00.000Z",
    });
    await store.completeDispatch(reserved.order.id, {
      providerOrderId: "regional-context-order",
      expectedTokenAmountAtomic: "100000",
      fees: [],
      expiresAt: null,
      instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "1", amount: "1000", currency: "IDR" },
      expectedVersion: reserved.order.version,
      updatedAt: "2026-09-12T00:00:01.000Z",
    });
    const events: Array<{ providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }> = [];
    const core = new FundingCore({
      providers: [provider],
      store,
      env: { US_HOOK: "us-secret", ID_HOOK: "id-secret" },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
      logUnmatchedWebhook: (event) => events.push(event),
    });

    await expect(core.handleWebhook("regional-context", new Uint8Array(), new Headers({ "x-signature": "us-secret" }))).resolves.toEqual({ accepted: true, matched: false });
    expect(events).toEqual([{ providerId: "regional-context", reason: "region-mismatch" }]);
  });

  test("verifies the receipt against a lower provider-settled amount and never a higher one", async () => {
    const verified: string[] = [];
    let settled = "1986000";
    let orders = 0;
    const provider: FundingProvider = {
      manifest,
      onramp: {
        async createOrder(input, ctx) {
          orders += 1;
          return { outcome: "created", order: { providerOrderId: `fixture-order-${orders}`, tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
        },
        async getOrder() { return { state: "sent", providerStatus: "MINTED:PAID", transactionHash: `0x${"2".repeat(64)}`, settledTokenAmountAtomic: settled, fees: [{ label: "QRIS Fee (0.7%)", amount: "140", currency: "IDR" }] }; },
      },
    };
    let date = new Date("2026-09-12T00:00:00.000Z");
    const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "500", verifyReceipt: async (order, hash) => { verified.push(order.expectedTokenAmountAtomic!); return { transactionHash: hash, logIndex: 4 }; }, now: () => date });
    const quote = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(created.expectedTokenAmountAtomic).toBe("2000000");
    date = new Date("2026-09-12T00:00:10.000Z");
    const received = await core.getOrder(session, created.id);
    expect(received.state).toBe("received");
    expect(received.expectedTokenAmountAtomic).toBe("1986000");
    expect(received.fees).toEqual([{ label: "QRIS Fee (0.7%)", amount: "140", currency: "IDR" }]);
    expect(verified).toEqual(["1986000"]);

    settled = "2000001";
    const higher = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    date = new Date("2026-09-12T00:01:00.000Z");
    const createdHigher = await core.createOrder(session, { quoteToken: higher.quoteToken }, "https://home.example");
    date = new Date("2026-09-12T00:01:10.000Z");
    const ignored = await core.getOrder(session, createdHigher.id);
    expect(ignored.state).toBe("awaiting-payment");
    expect(ignored.expectedTokenAmountAtomic).toBe("2000000");
    expect(ignored.fees).toEqual([]);
    expect(verified).toEqual(["1986000"]);
  });

  test("emits a provider failure and preserves the order when a settlement is rejected", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    try {
      const provider: FundingProvider = {
        manifest,
        onramp: {
          async createOrder(input, ctx) {
            return { outcome: "created", order: { providerOrderId: "fixture-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
          },
          async getOrder() {
            return { state: "sent", providerStatus: "MINTED:PAID", settledTokenAmountAtomic: "2000001" };
          },
        },
      };
      let date = new Date("2026-09-12T00:00:00.000Z");
      const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "500", verifyReceipt: async () => null, now: () => date });
      const quote = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
      const created = await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      date = new Date("2026-09-12T00:00:10.000Z");

      expect(await core.getOrder(session, created.id)).toEqual(created);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        kind: "funding-order",
        route: "/api/funding/orders/:redacted",
        code: "PROVIDER_INVALID_RESPONSE",
        provider: "fixture",
        region: "ID",
      });
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("keeps the quoted amount as the baseline and freezes the first accepted settlement", async () => {
    const seen: string[] = [];
    let settled = "1900000";
    const provider: FundingProvider = {
      manifest,
      onramp: {
        async createOrder(input, ctx) {
          return { outcome: "created", order: { providerOrderId: "fixture-order-1", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
        },
        async getOrder(input) {
          seen.push(input.expectedTokenAmountAtomic);
          return { state: "sent", providerStatus: "PROCESSING:PAID", settledTokenAmountAtomic: settled, fees: [{ label: "Fee", amount: "1000", currency: "IDR" }] };
        },
      },
    };
    let date = new Date("2026-09-12T00:00:00.000Z");
    const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "500", verifyReceipt: async () => null, now: () => date });
    const quote = await core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    const created = await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    date = new Date("2026-09-12T00:00:10.000Z");
    const lowered = await core.getOrder(session, created.id);
    expect(lowered.state).toBe("sent-unverified");
    expect(lowered.expectedTokenAmountAtomic).toBe("1900000");

    // A second, lower settlement is bounded by the adapter against the quoted
    // amount, and the core drops it regardless: the first one is frozen.
    settled = "1805000";
    date = new Date("2026-09-12T00:00:20.000Z");
    const again = await core.getOrder(session, created.id);
    expect(again.expectedTokenAmountAtomic).toBe("1900000");
    expect(again.updatedAt).toBe(lowered.updatedAt);
    expect(seen).toEqual(["2000000", "2000000"]);

    // Reporting the accepted amount again is fine and keeps the refresh alive.
    settled = "1900000";
    date = new Date("2026-09-12T00:00:30.000Z");
    const same = await core.getOrder(session, created.id);
    expect(same.expectedTokenAmountAtomic).toBe("1900000");
    expect(same.updatedAt).toBe("2026-09-12T00:00:30.000Z");
  });

  test("logs unmatched webhooks without raw bodies or provider order identifiers", async () => {
    const events: Array<{ providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }> = [];
    const provider: FundingProvider = { manifest, onramp: { createOrder: async () => ({ outcome: "ambiguous" }), getOrder: async () => ({ state: "unknown", providerStatus: "unknown" }), verifyWebhook: () => ({ providerOrderId: "secret-provider-order" }) } };
    const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) }, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logUnmatchedWebhook: (event) => events.push(event) });
    expect(await core.handleWebhook("fixture", new TextEncoder().encode("private-body"), new Headers())).toEqual({ accepted: true, matched: false });
    expect(events).toEqual([{ providerId: "fixture", reason: "unmatched" }]);
    expect(JSON.stringify(events)).not.toContain("secret-provider-order");
    expect(JSON.stringify(events)).not.toContain("private-body");
  });

  test("rejects a tampered quote before provider dispatch", async () => {
    const fixture = setup();
    const quote = await fixture.core.createQuote(session, { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" }, "https://home.example");
    await expect(fixture.core.createOrder(session, { quoteToken: `${quote.quoteToken}x` }, "https://home.example")).rejects.toEqual(expect.objectContaining({ code: "INVALID_QUOTE_TOKEN" }));
    const otherOwner = { ...session, user: { subject: "other-user" } };
    await expect(fixture.core.createOrder(otherOwner, { quoteToken: quote.quoteToken }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_QUOTE_TOKEN" });
    expect(fixture.blockReads()).toBe(0);
    expect(fixture.dispatches()).toBe(0);
  });

  test("passes the request origin return URL into provider quotes", async () => {
    const captured: QuoteIntent[] = [];
    const provider: FundingProvider = {
      manifest: { ...manifest, onramp: { ...manifest.onramp, quotes: true } },
      onramp: {
        async createQuote(input) {
          captured.push(input);
          return {
            fiatAmount: input.fiatAmount,
            tokenAmountAtomic: "2000000",
            fees: [],
            expiresAt: "2099-01-01T00:00:00.000Z",
          };
        },
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const core = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });
    await core.createQuote(
      session,
      { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" },
      "https://preview.home.example",
    );
    expect(captured[0]?.returnUrl).toBe("https://preview.home.example/fund?return=funding");
  });

  test("propagates provider quote transport errors for the route to report QUOTE_UNAVAILABLE", async () => {
    const providerError = Object.assign(new TypeError("synthetic quote timeout"), {
      code: "ETIMEDOUT",
    });
    const provider: FundingProvider = {
      manifest: { ...manifest, onramp: { ...manifest.onramp, quotes: true } },
      onramp: {
        async createQuote() { throw providerError; },
        async createOrder() { return { outcome: "ambiguous" }; },
        async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
      },
    };
    const core = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: {
        FIXTURE_KEY: "set",
        FUNDING_QUOTE_SECRET: "x".repeat(32),
      },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });

    try {
      await core.createQuote(
        session,
        { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" },
        "https://home.example",
      );
      throw new Error("Expected provider quote error.");
    } catch (error) {
      expect(error).toBe(providerError);
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ code: "ETIMEDOUT" });
    }
  });

  test("marks a contradictory post-create token echo dispatch-ambiguous", async () => {
    const core = coreWithInstruction(
      { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: "20000", currency: "IDR" },
      "1999999",
    );
    const quote = await core.createQuote(
      session,
      { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" },
      "https://home.example",
    );
    const order = await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
    expect(order.state).toBe("dispatch-ambiguous");
    expect(order.instructions).toBeNull();
  });

  test("persists a safe embed instruction while awaiting payment", async () => {
    const instruction = {
      kind: "embed",
      url: "https://pay.example/apple-pay",
      presentation: "apple-pay",
      amount: "20.50",
      currency: "USD",
    } as const satisfies Instruction;
    const core = coreWithInstruction(instruction);
    const quote = await core.createQuote(
      session,
      { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" },
      "https://home.example",
    );
    const order = await core.createOrder(
      session,
      { quoteToken: quote.quoteToken },
      "https://home.example",
    );

    expect(order.state).toBe("awaiting-payment");
    expect(order.instructions).toEqual(instruction);
  });

  test("marks unsafe redirect and embed instruction values dispatch-ambiguous", async () => {
    const scenarios: Array<
      | Extract<Instruction, { kind: "redirect" }>
      | Extract<Instruction, { kind: "embed" }>
    > = [
      { kind: "redirect", url: "https://evil.example/pay" },
      { kind: "redirect", url: "http://pay.example/pay" },
      { kind: "redirect", url: "https://user@pay.example/pay" },
      { kind: "embed", url: "https://pay.example/pay#secret", presentation: "apple-pay", amount: "20", currency: "USD" },
      { kind: "embed", url: `https://pay.example/${"x".repeat(4096)}`, presentation: "apple-pay", amount: "20", currency: "USD" },
      { kind: "embed", url: "https://pay.example/pay", presentation: "apple-pay", amount: "020", currency: "USD" },
      { kind: "embed", url: "https://pay.example/pay", presentation: "apple-pay", amount: "20", currency: "usd" },
    ];
    for (const instruction of scenarios) {
      const core = coreWithInstruction(instruction);
      const quote = await core.createQuote(
        session,
        { providerId: "fixture", region: "ID", paymentMethod: "bank", fiatAmount: "20000" },
        "https://home.example",
      );
      const order = await core.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example");
      expect(order.state, instruction.url).toBe("dispatch-ambiguous");
      expect(order.instructions).toBeNull();
    }
  });
});

function coreWithInstruction(
  instructions: Instruction,
  expectedTokenAmountAtomic = "2000000",
  transitionEvents?: FundingOrderTransitionEvent[],
): FundingCore {
  const provider: FundingProvider = {
    manifest: { ...manifest, onramp: { ...manifest.onramp, redirectOrigins: ["https://pay.example"] } },
    onramp: {
      async createOrder(_input, ctx) {
      return {
        outcome: "created",
        order: {
          providerOrderId: "fixture-order",
          tokenAddress: ctx.binding.asset.address,
          expectedTokenAmountAtomic,
          fees: [],
          expiresAt: null,
          instructions,
        },
      };
    },
      async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
    },
  };
  return new FundingCore({
    providers: [provider],
    store: new MemoryFundingOrderStore(),
    env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32) },
    currentBaseBlock: async () => "1",
    verifyReceipt: async () => null,
    ...(transitionEvents ? { logOrderTransition: (event: FundingOrderTransitionEvent) => transitionEvents.push(event) } : {}),
  });
}

describe("resolveClientIp", () => {
  const headers = (ip?: string) => new Headers(ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {});
  test("returns the first forwarded hop and ignores the sandbox override outside sandbox mode", () => {
    expect(resolveClientIp(headers("203.0.113.9"), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, false)).toBe("203.0.113.9");
    expect(resolveClientIp(headers("127.0.0.1"), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, false)).toBe("127.0.0.1");
    expect(resolveClientIp(headers(), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, false)).toBeUndefined();
  });
  test("rejects arbitrary forwarded header values", () => {
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.9 attacker" }), {}, false)).toBeUndefined();
    expect(resolveClientIp(new Headers({ "x-real-ip": "not-an-ip" }), {}, false)).toBeUndefined();
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "a" }), {}, false)).toBeUndefined();
  });
  test("substitutes the sandbox override only for a missing or private forwarded IP", () => {
    expect(resolveClientIp(headers("127.0.0.1"), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, true)).toBe("198.51.100.7");
    expect(resolveClientIp(headers("::1"), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, true)).toBe("198.51.100.7");
    expect(resolveClientIp(headers(), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, true)).toBe("198.51.100.7");
    expect(resolveClientIp(headers("203.0.113.9"), { FUNDING_SANDBOX_CLIENT_IP: "198.51.100.7" }, true)).toBe("203.0.113.9");
    expect(resolveClientIp(headers("127.0.0.1"), {}, true)).toBe("127.0.0.1");
  });
  test("classifies private ranges", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.1", "169.254.1.1",
      "100.64.0.1", "100.127.255.254", "::", "0:0:0:0:0:0:0:0", "0000:0000:0000:0000:0000:0000:0000:0000",
      "::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:192.168.0.5", "::ffff:172.16.0.1", "::ffff:172.31.255.1",
      "fd12::1", "fe80::1",
    ]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of [
      "203.0.113.9", "172.32.0.1", "8.8.8.8", "100.63.255.255", "100.128.0.1", "::ffff:8.8.8.8", "2001:db8::1",
      "localhost", "private.example", "fc.example", "fe80.example",
    ]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});
