import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import type { FundingProvider, CreateOrderResult } from "@/shared/funding/provider-contract";
import { FundingUserTokenVault, USER_TOKEN_LOCAL_REUSE_MS, userTokenAad, type FundingUserTokenBinding } from "./provider-user-token";
import { FundingCore } from "./service";
import { MemoryFundingOrderStore } from "./store";
import { MemoryFundingProviderUserTokenStore, type FundingProviderUserTokenStore } from "./user-token-store";
import { rotateUserTokens } from "./user-token-rotation";

const address = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = { user: { subject: "owner" }, accountProvider: "base-account", smartAccount: { address, chainId: 8453 } };
const secret = randomBytes(32).toString("base64url");
const environment = { FUNDING_QUOTE_SECRET: "synthetic-quote-secret".repeat(4), FIXTURE_KEY: "configured", HOME_SECRET_ENCRYPTION_KEY: secret, HOME_SECRET_KEY_VERSION: "1" };
const binding: FundingUserTokenBinding = { owner: { subject: "owner", accountProvider: "base-account" }, providerId: "fixture", region: "US", sandbox: false, destination: address };
async function captureCurrent(vault: FundingUserTokenVault, store: FundingProviderUserTokenStore, target: FundingUserTokenBinding, token: string) {
  return vault.capture(target, token, (await store.get(target))?.envelope ?? null);
}
function setup(options: { env?: typeof environment; tokenStore?: MemoryFundingProviderUserTokenStore; failComplete?: boolean } = {}) {
  let date = new Date("2026-09-18T00:00:00.000Z"), calls = 0, dispatchHook: (() => Promise<void>) | null = null;
  const observed: Array<string | null> = [], diagnostics: string[] = [];
  let outcome: "created" | "ambiguous" | "rejected" | "pre-dispatch-rejected" = "created";
  const tokenStore = options.tokenStore ?? new MemoryFundingProviderUserTokenStore();
  const orderStore = new MemoryFundingOrderStore();
  const store = options.failComplete ? new Proxy(orderStore, { get(target, property) {
    if (property === "completeDispatch") return async () => { throw new Error("complete failed"); };
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } }) : orderStore;
  const provider: FundingProvider = { manifest: { id: "fixture", displayName: "Fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://example.com"], reference: "home" }, bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: { paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], env: ["FIXTURE_KEY"] } } }] }, onramp: {
    async createOrder() { throw new Error("generic dispatch must not be called"); },
    async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
  } };
  const vault = new FundingUserTokenVault({ store: tokenStore, env: options.env ?? environment, now: () => date, diagnose: (code) => diagnostics.push(code) });
  const core = new FundingCore({ providers: [provider], store, userTokenVault: vault, userTokenProviders: new Map([["fixture", async (intent, credential, ctx): Promise<{ result: CreateOrderResult; userAuthToken: string | null; credentialRejected: boolean }> => {
    calls++; observed.push(credential.userAuthToken);
    if (dispatchHook) { const hook = dispatchHook; dispatchHook = null; await hook(); }
    if (outcome !== "created") return { result: outcome === "ambiguous" ? { outcome: "ambiguous" } : { outcome: "rejected", message: "rejected" }, userAuthToken: null, credentialRejected: outcome === "rejected" && credential.userAuthToken !== null };
    return { result: { outcome: "created", order: { providerOrderId: `fixture-${calls}`, tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: intent.quote!.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "bank-transfer", rail: "test", accountNumber: "000", amount: intent.fiatAmount, currency: "USD" } } }, userAuthToken: "synthetic-returned-token", credentialRejected: false };
  }]]), env: options.env ?? environment, now: () => date, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
  async function purchase(asSession = session) {
    const { quoteToken } = await core.createQuote(asSession, { providerId: "fixture", region: "US", paymentMethod: "apple-pay", fiatAmount: "5" }, "https://home.example");
    const result = await core.createOrder(asSession, { quoteToken }, "https://home.example");
    date = new Date(date.getTime() + 1_000);
    return result;
  }
  return { purchase, vault, tokenStore, orderStore, observed, diagnostics, calls: () => calls, setOutcome(value: typeof outcome) { outcome = value; }, setDate(value: Date) { date = value; }, seed: (target: FundingUserTokenBinding, token: string) => captureCurrent(vault, tokenStore, target, token), onDispatch(hook: (() => Promise<void>) | null) { dispatchHook = hook; } };
}
test("first purchase captures only after dispatch, exact tuple reuses, and public/stored orders omit token", async () => {
  const fixture = setup();
  const first = await fixture.purchase();
  expect(fixture.observed).toEqual([null]);
  expect((await fixture.tokenStore.get(binding))?.envelope).not.toContain("synthetic-returned-token");
  const second = await fixture.purchase();
  expect(fixture.observed).toEqual([null, "synthetic-returned-token"]);
  expect(JSON.stringify([first, second, await fixture.orderStore.getOwned(first.id, binding.owner)])).not.toContain("synthetic-returned-token");
  expect(JSON.stringify(second.quoteToken)).not.toContain("synthetic-returned-token");
});
test("cross-owner, account provider and destination cannot reuse; unreadable remains recoverable", async () => {
  const fixture = setup();
  await fixture.seed(binding, "synthetic-returned-token");
  const other = { ...session, user: { subject: "other" } };
  const otherProvider = { ...session, accountProvider: "cdp-embedded" as const };
  const otherDestination = { ...session, smartAccount: { address: "0x2222222222222222222222222222222222222222" as const, chainId: 8453 as const } };
  await fixture.purchase(other);
  await fixture.purchase(otherProvider);
  expect(fixture.observed).toEqual([null, null]);
  expect((await fixture.tokenStore.get(binding))?.envelope).toBeTruthy();
  const wrongKey = setup({ tokenStore: fixture.tokenStore, env: { ...environment, HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url") } });
  await wrongKey.purchase();
  expect(wrongKey.observed).toEqual([null]);
  expect(wrongKey.diagnostics).toContain("unreadable");
  await fixture.purchase(otherDestination);
  expect(fixture.observed).toEqual([null, null, null]);
  expect(await fixture.tokenStore.get(binding)).not.toBeNull();
});
test("capture preserves wrong-key and newer-version ciphertext byte for byte", async () => {
  for (const env of [
    { ...environment, HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url") },
    { ...environment, HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "2" },
  ]) {
    const store = new MemoryFundingProviderUserTokenStore();
    const ring = resolveSecretKeyring(env);
    if (!ring.ok) throw new Error("invalid synthetic keyring");
    const initial = { destination: binding.destination, envelope: sealSecret(ring.keyring, "recoverable-token", userTokenAad(binding)), returnedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    expect(await store.putIfEnvelope(binding, null, initial)).toBe(true);
    const fixture = setup({ tokenStore: store });
    expect(await fixture.seed(binding, "new-token")).toBe(false);
    expect(await store.get(binding)).toEqual({ ...initial, keyVersion: Number(env.HOME_SECRET_KEY_VERSION) });
    expect(fixture.diagnostics).toEqual(["preserved-unreadable"]);
  }
});
test("capture replaces readable rows, expired unreadable rows, and readable rows for another destination", async () => {
  const alternate = { ...binding, destination: "0x2222222222222222222222222222222222222222" };
  for (const originalBinding of [binding, alternate]) {
    const fixture = setup();
    expect(await fixture.seed(originalBinding, "original-token")).toBe(true);
    const before = (await fixture.tokenStore.get(binding))!;
    expect(await fixture.seed(binding, "new-token")).toBe(true);
    const after = (await fixture.tokenStore.get(binding))!;
    expect(after.envelope).not.toBe(before.envelope);
    expect(after.destination).toBe(binding.destination);
    expect((await fixture.vault.read(binding))?.token).toBe("new-token");
  }
  const store = new MemoryFundingProviderUserTokenStore();
  const ring = resolveSecretKeyring({ ...environment, HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url") });
  if (!ring.ok) throw new Error("invalid synthetic keyring");
  const oldDate = new Date("2026-09-18T00:00:00.000Z");
  const envelope = sealSecret(ring.keyring, "old-token", userTokenAad(binding));
  expect(await store.putIfEnvelope(binding, null, { destination: binding.destination, envelope, returnedAt: oldDate.toISOString(), updatedAt: oldDate.toISOString() })).toBe(true);
  const fixture = setup({ tokenStore: store });
  fixture.setDate(new Date(oldDate.getTime() + USER_TOKEN_LOCAL_REUSE_MS));
  expect(await fixture.seed(binding, "new-token")).toBe(true);
  expect((await store.get(binding))?.envelope).not.toBe(envelope);
  expect((await fixture.vault.read(binding))?.token).toBe("new-token");
});
test("an echoed token keeps its original returned age so reuse still stops at the local limit", async () => {
  const fixture = setup();
  const firstReturnedAt = new Date("2026-09-18T00:00:00.000Z");
  await fixture.purchase();
  expect((await fixture.tokenStore.get(binding))?.returnedAt).toBe(firstReturnedAt.toISOString());
  fixture.setDate(new Date(firstReturnedAt.getTime() + USER_TOKEN_LOCAL_REUSE_MS / 2));
  await fixture.purchase();
  expect(fixture.observed).toEqual([null, "synthetic-returned-token"]);
  expect((await fixture.tokenStore.get(binding))?.returnedAt).toBe(firstReturnedAt.toISOString());
  fixture.setDate(new Date(firstReturnedAt.getTime() + USER_TOKEN_LOCAL_REUSE_MS));
  await fixture.purchase();
  expect(fixture.observed).toEqual([null, "synthetic-returned-token", null]);
  expect(await fixture.seed(binding, "fresh-token")).toBe(true);
  expect((await fixture.tokenStore.get(binding))?.returnedAt).not.toBe(firstReturnedAt.toISOString());
  const moved = setup();
  expect(await moved.seed({ ...binding, destination: "0x2222222222222222222222222222222222222222" }, "fresh-token")).toBe(true);
  moved.setDate(new Date(firstReturnedAt.getTime() + 1_000));
  expect(await moved.seed(binding, "fresh-token")).toBe(true);
  expect((await moved.tokenStore.get(binding))?.returnedAt).toBe(new Date(firstReturnedAt.getTime() + 1_000).toISOString());
});
test("capture loses a compare-and-swap race without overwriting the winner", async () => {
  const store = new MemoryFundingProviderUserTokenStore();
  const fixture = setup({ tokenStore: store });
  expect(await fixture.seed(binding, "first-token")).toBe(true);
  const winner = setup({ tokenStore: store });
  const racing: FundingProviderUserTokenStore = new Proxy(store, { get(target, property) {
    if (property === "putIfEnvelope") return async (...args: Parameters<FundingProviderUserTokenStore["putIfEnvelope"]>) => {
      await winner.seed(binding, "winner-token");
      return store.putIfEnvelope(...args);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const diagnostics: string[] = [];
  const vault = new FundingUserTokenVault({ store: racing, env: environment, now: () => new Date("2026-09-18T00:00:00.000Z"), diagnose: (code) => { diagnostics.push(code); } });
  expect(await vault.capture(binding, "loser-token", (await store.get(binding))!.envelope)).toBe(false);
  expect(diagnostics).toEqual(["capture-conflict"]);
  expect((await winner.vault.read(binding))?.token).toBe("winner-token");
});
test("a stale create response cannot overwrite a token captured by an overlapping create", async () => {
  const vault = new FundingUserTokenVault({ store: new MemoryFundingProviderUserTokenStore(), env: environment, now: () => new Date("2026-09-18T00:00:00.000Z"), diagnose: () => undefined });
  expect(await vault.capture(binding, "old-token", null)).toBe(true);
  const dispatchRead = (await vault.readForDispatch(binding))!;
  expect(await vault.capture(binding, "refreshed-token", dispatchRead.expectedEnvelope)).toBe(true);
  expect(await vault.capture(binding, "old-token", dispatchRead.expectedEnvelope)).toBe(false);
  expect(await vault.capture(binding, "old-token", null)).toBe(false);
  expect((await vault.read(binding))?.token).toBe("refreshed-token");
});
test("an overlapping create's refreshed token survives a later echo of the credential read before dispatch", async () => {
  const fixture = setup();
  await fixture.purchase();
  const returnedAt = (await fixture.tokenStore.get(binding))!.returnedAt;
  fixture.onDispatch(async () => { expect(await fixture.seed(binding, "refreshed-token")).toBe(true); });
  await fixture.purchase();
  expect(fixture.observed).toEqual([null, "synthetic-returned-token"]);
  expect(fixture.diagnostics).toContain("capture-conflict");
  expect((await fixture.vault.read(binding))?.token).toBe("refreshed-token");
  expect((await fixture.tokenStore.get(binding))?.returnedAt).not.toBe(returnedAt);
});
test("region, sandbox and owner bindings do not reuse a stored token", async () => {
  const fixture = setup();
  await fixture.seed(binding, "synthetic-returned-token");
  for (const changed of [
    { ...binding, region: "CA" }, { ...binding, sandbox: true },
    { ...binding, owner: { ...binding.owner, subject: "another" } },
    { ...binding, owner: { ...binding.owner, accountProvider: "cdp-embedded" as const } },
    { ...binding, destination: "0x2222222222222222222222222222222222222222" },
  ]) expect(await fixture.vault.read(changed)).toBeNull();
  expect((await fixture.vault.read(binding))?.token).toBe("synthetic-returned-token");
});
test("rejected reuse clears for next create once; ambiguous reuse preserves", async () => {
  const fixture = setup();
  await fixture.seed(binding, "synthetic-returned-token");
  fixture.setOutcome("rejected");
  await fixture.purchase();
  expect(fixture.calls()).toBe(1);
  expect(await fixture.tokenStore.get(binding)).toBeNull();
  await fixture.purchase();
  expect(fixture.observed).toEqual(["synthetic-returned-token", null]);
  const separate = setup();
  await separate.seed(binding, "synthetic-returned-token");
  separate.setOutcome("ambiguous");
  await separate.purchase();
  expect((await separate.tokenStore.get(binding))?.envelope).toBeTruthy();
});
test("pre-dispatch rejection preserves the stored token for the next attempt", async () => {
  const fixture = setup();
  await fixture.seed(binding, "synthetic-returned-token");
  const envelope = (await fixture.tokenStore.get(binding))!.envelope;
  fixture.setOutcome("pre-dispatch-rejected");
  await fixture.purchase();
  expect((await fixture.tokenStore.get(binding))?.envelope).toBe(envelope);
  expect(fixture.diagnostics).not.toContain("cleared-after-rejection");
  fixture.setOutcome("created");
  await fixture.purchase();
  expect(fixture.observed).toEqual(["synthetic-returned-token", "synthetic-returned-token"]);
});
test("55-day boundary and CAS cleanup preserve concurrent replacement", async () => {
  const fixture = setup();
  await fixture.seed(binding, "synthetic-returned-token");
  fixture.setDate(new Date(Date.parse("2026-09-18T00:00:00.000Z") + USER_TOKEN_LOCAL_REUSE_MS - 1));
  expect((await fixture.vault.read(binding))?.token).toBe("synthetic-returned-token");
  fixture.setDate(new Date(Date.parse("2026-09-18T00:00:00.000Z") + USER_TOKEN_LOCAL_REUSE_MS));
  expect(await fixture.vault.read(binding)).toBeNull();
  expect(await fixture.tokenStore.get(binding)).toBeNull();
});
test("expiration compare-delete cannot remove a concurrent replacement", async () => {
  const store = new MemoryFundingProviderUserTokenStore();
  const start = new Date("2026-09-18T00:00:00.000Z");
  const baseline = new FundingUserTokenVault({ store, env: environment, now: () => start, diagnose: () => undefined });
  await captureCurrent(baseline, store, binding, "old-token");
  const old = (await store.get(binding))!.envelope;
  const now = new Date(start.getTime() + USER_TOKEN_LOCAL_REUSE_MS);
  const latest = new FundingUserTokenVault({ store, env: environment, now: () => now, diagnose: () => undefined });
  const concurrent: FundingProviderUserTokenStore = new Proxy(store, { get(target, property) {
    if (property === "deleteIfEnvelope") return async () => {
      await captureCurrent(latest, store, binding, "replacement-token");
      return store.deleteIfEnvelope(binding, old);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const vault = new FundingUserTokenVault({ store: concurrent, env: environment, now: () => now, diagnose: () => undefined });
  expect(await vault.read(binding)).toBeNull();
  expect((await latest.read(binding))?.token).toBe("replacement-token");
});
test("rejection cleanup reports a clear only when its compare-delete removes the rejected envelope", async () => {
  const store = new MemoryFundingProviderUserTokenStore();
  const diagnostics: string[] = [];
  const now = new Date("2026-09-18T00:00:00.000Z");
  const vault = new FundingUserTokenVault({ store, env: environment, now: () => now, diagnose: (code) => diagnostics.push(code) });
  await captureCurrent(vault, store, binding, "rejected-token");
  const rejected = (await store.get(binding))!.envelope;
  await captureCurrent(vault, store, binding, "replacement-token");
  diagnostics.length = 0;
  expect(await vault.clearAfterRejection(binding, { token: "rejected-token", envelope: rejected })).toBe(false);
  expect(diagnostics).toEqual(["rejection-clear-conflict"]);
  expect((await vault.read(binding))?.token).toBe("replacement-token");
  const current = (await store.get(binding))!.envelope;
  diagnostics.length = 0;
  expect(await vault.clearAfterRejection(binding, { token: "replacement-token", envelope: current })).toBe(true);
  expect(diagnostics).toEqual(["cleared-after-rejection"]);
  expect(await store.get(binding)).toBeNull();
});
test("rejection cleanup still clears the rejected token after a concurrent key-rotation re-encrypt", async () => {
  const previousKey = randomBytes(32).toString("base64url");
  const rotatedEnv = { ...environment, HOME_SECRET_KEY_VERSION: "2", HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: previousKey };
  const previousRing = resolveSecretKeyring({ ...environment, HOME_SECRET_ENCRYPTION_KEY: previousKey });
  const activeRing = resolveSecretKeyring(rotatedEnv);
  if (!previousRing.ok || !activeRing.ok) throw new Error("invalid synthetic keyring");
  const inner = new MemoryFundingProviderUserTokenStore();
  const now = new Date("2026-09-18T00:00:00.000Z");
  await inner.putIfEnvelope(binding, null, { destination: binding.destination, envelope: sealSecret(previousRing.keyring, "rejected-token", userTokenAad(binding)), returnedAt: now.toISOString(), updatedAt: now.toISOString() });
  let raced = false;
  const racing = new Proxy(inner, { get(target, property) {
    if (property === "deleteIfEnvelope") return async (key: FundingUserTokenBinding, envelope: string) => {
      if (!raced) { raced = true; expect(await rotateUserTokens(target, activeRing.keyring, () => now)).toEqual({ rotated: 1, unreadable: 0, skippedConcurrent: 0 }); }
      return target.deleteIfEnvelope(key, envelope);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const diagnostics: string[] = [];
  const vault = new FundingUserTokenVault({ store: racing, env: rotatedEnv, now: () => now, diagnose: (code) => diagnostics.push(code) });
  const stored = (await vault.read(binding))!;
  expect(stored.token).toBe("rejected-token");
  expect(await vault.clearAfterRejection(binding, stored)).toBe(true);
  expect(raced).toBe(true);
  expect(diagnostics).toEqual(["cleared-after-rejection"]);
  expect(await inner.get(binding)).toBeNull();
});
test("rejection cleanup keeps a semantic replacement written after a key-rotation re-encrypt", async () => {
  const store = new MemoryFundingProviderUserTokenStore();
  const now = new Date("2026-09-18T00:00:00.000Z");
  const diagnostics: string[] = [];
  const vault = new FundingUserTokenVault({ store, env: environment, now: () => now, diagnose: (code) => diagnostics.push(code) });
  await captureCurrent(vault, store, binding, "rejected-token");
  const stored = (await vault.read(binding))!;
  const ring = resolveSecretKeyring(environment);
  if (!ring.ok) throw new Error("invalid synthetic keyring");
  const reencrypted = sealSecret(ring.keyring, "replacement-token", userTokenAad(binding));
  await store.replaceIfEnvelope(binding, stored.envelope, { envelope: reencrypted, updatedAt: now.toISOString() });
  diagnostics.length = 0;
  expect(await vault.clearAfterRejection(binding, stored)).toBe(false);
  expect(diagnostics).toEqual(["rejection-clear-conflict"]);
  expect((await vault.read(binding))?.token).toBe("replacement-token");
});
test("completeDispatch failure does not capture token; missing keys and store write failure never block orders", async () => {
  const failure = setup({ failComplete: true });
  await expect(failure.purchase()).rejects.toThrow("complete failed");
  expect(await failure.tokenStore.get(binding)).toBeNull();
  const missing = setup({ env: { ...environment, HOME_SECRET_ENCRYPTION_KEY: "" } });
  await missing.purchase();
  expect(missing.observed).toEqual([null]);
  expect(await missing.tokenStore.get(binding)).toBeNull();
  const broken = new MemoryFundingProviderUserTokenStore();
  broken.putIfEnvelope = async () => { throw new Error("private synthetic failure"); };
  const fallback = setup({ tokenStore: broken });
  await fallback.purchase();
  expect(fallback.diagnostics).toContain("store-failure");
});
