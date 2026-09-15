import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  FundingProvider,
  FundingProviderManifest,
  Instruction,
  QuoteIntent,
} from "@/shared/funding/provider-contract";
import { MemoryFundingOrderStore } from "./store";
import { FundingCore, resolveClientIp, isPrivateIp } from "./service";
import { FundingProviderConfigurationError, resolveFundingMode, resolveWebhookEnvironment } from "./provider-context";

const session: VerifiedAccountSession = { user: { subject: "user" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const manifest = { id: "fixture", displayName: "Fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" }, bindings: [{ region: "ID", assetId: "base:idrx", currency: "IDR", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"] } } }] } as const satisfies FundingProviderManifest;

function setup(
  outcome: "created" | "ambiguous" = "created",
  options: { sandbox?: boolean; providerSandbox?: boolean } = {},
) {
  let dispatches = 0;
  let blockReads = 0;
  let receiptVerifications = 0;
  const getOrderSandboxes: boolean[] = [];
  let observation: "awaiting-payment" | "sent" = "awaiting-payment";
  let date = new Date("2026-09-12T00:00:00.000Z");
  const staleSignals: Array<{ address: string; at: string }> = [];
  const provider: FundingProvider = {
    manifest: options.providerSandbox ? { ...manifest, onramp: { ...manifest.onramp, sandbox: true, modeEnv: "FIXTURE_ONRAMP_MODE" } } : manifest,
    onramp: {
      async createOrder(input, ctx) {
      dispatches += 1;
      expect(input.destination).toBe(session.smartAccount!.address);
      if (outcome === "ambiguous") return { outcome: "ambiguous" };
      return { outcome: "created", order: { providerOrderId: "fixture-order", tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: input.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "VA", accountNumber: "12345678", amount: input.fiatAmount, currency: "IDR" } } };
    },
      async getOrder(_input, ctx) {
        getOrderSandboxes.push(ctx.sandbox);
        return { state: observation, providerStatus: observation, transactionHash: observation === "sent" ? `0x${"2".repeat(64)}` : null };
      },
    },
  };
  const core = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), env: { FIXTURE_KEY: "set", FUNDING_QUOTE_SECRET: "s".repeat(32), ...(options.sandbox ? { FIXTURE_ONRAMP_MODE: "sandbox" } : {}) }, currentBaseBlock: async () => { blockReads += 1; return "500"; }, verifyReceipt: async (_order, hash) => { receiptVerifications += 1; return { transactionHash: hash, logIndex: 4 }; }, markStale: async (address, at) => { staleSignals.push({ address, at: at.toISOString() }); }, now: () => date });
  return { core, dispatches: () => dispatches, blockReads: () => blockReads, receiptVerifications: () => receiptVerifications, getOrderSandboxes: () => getOrderSandboxes, staleSignals: () => staleSignals, advance(minutes: number) { date = new Date(date.getTime() + minutes * 60_000); }, sent() { observation = "sent"; date = new Date("2026-09-12T00:00:10.000Z"); } };
}

describe("FundingCore", () => {
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

  test("reports hidden offramp discovery failures without request data", async () => {
    const events: Array<{ providerId: string; reason: "configuration" | "provider"; code: string }> = [];
    const provider: FundingProvider = {
      manifest: {
        id: "offramp-fixture", displayName: "Offramp", docsUrl: "https://example.com",
        offramp: { production: { apiOrigins: ["https://off.example"], contracts: { escrow: "0x1111111111111111111111111111111111111111", intentGuardian: "0x2222222222222222222222222222222222222222", intentGatingService: "0x3333333333333333333333333333333333333333" } } },
        bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { offramp: { paymentMethods: [{ id: "cashapp", label: "Cash App" }], env: ["OFFRAMP_ENABLED"], confirmedBy: "fixture" } } }],
      },
      offramp: { capabilities: async () => { throw new Error("provider unavailable"); } } as unknown as NonNullable<FundingProvider["offramp"]>,
    };
    const core = new FundingCore({
      providers: [provider], store: new MemoryFundingOrderStore(), env: { OFFRAMP_ENABLED: "1" },
      currentBaseBlock: async () => "1", verifyReceipt: async () => null,
      logProviderDiscoveryFailure: (event) => { events.push(event); },
    });
    expect(await core.listProviders("US", session, "offramp")).toEqual([]);
    expect(events).toEqual([{
      providerId: "offramp-fixture",
      reason: "provider",
      code: "FUNDING_PROVIDER_CONFIGURATION",
    }]);
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

    expect(await core.listProviders("ID", session)).toEqual([]);
    expect(events).toEqual([{
      providerId: "fixture",
      reason: "configuration",
      code: "FUNDING_SANDBOX_MIGRATION_REQUIRED",
    }]);
    expect(JSON.stringify(events)).not.toContain("secret-value");
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

  test("binds webhook signatures to the order region while preserving shared-secret manifests", async () => {
    const run = async (webhookEnv: string | { US: string; ID: string }, signature: string, removeOrderRegionSecret = false) => {
      let refreshes = 0;
      const matchedEvents: Array<{ providerId: string; region: string }> = [];
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
      const core = new FundingCore({ providers: [provider], store, env: runtimeEnv, currentBaseBlock: async () => "1", verifyReceipt: async () => null, logMatchedWebhook: (event) => matchedEvents.push(event) });
      const result = await core.handleWebhook("regional", new Uint8Array(), new Headers({ "x-signature": signature }));
      return { result, refreshes, matchedEvents };
    };

    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "id-secret")).toEqual({ result: { accepted: true, matched: true }, refreshes: 1, matchedEvents: [{ providerId: "regional", region: "ID" }] });
    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "us-secret")).toEqual({ result: { accepted: true, matched: false }, refreshes: 0, matchedEvents: [] });
    expect(await run("SHARED_HOOK", "us-secret")).toEqual({ result: { accepted: true, matched: true }, refreshes: 1, matchedEvents: [{ providerId: "regional", region: "ID" }] });
    expect(await run({ US: "US_HOOK", ID: "ID_HOOK" }, "us-secret", true)).toEqual({ result: { accepted: true, matched: false }, refreshes: 0, matchedEvents: [] });
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
