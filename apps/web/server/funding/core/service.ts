import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { getFundingAsset } from "@/shared/funding/assets";
import type { FundingProvider, Observation, Quote } from "@/shared/funding/provider-contract";
import { createProviderContext } from "./provider-context";
import { authenticateFundingQuote, isFundingQuoteExpired, signFundingQuote } from "./quote-token";
import type { FundingOrder, FundingOrderOwner, FundingOrderStore } from "./store";

export type ReceiptMatch = { transactionHash: `0x${string}`; logIndex: number } | null;

type Environment = Readonly<Record<string, string | undefined>>;
export type FundingCoreDependencies = {
  providers: ReadonlyArray<FundingProvider>;
  store: FundingOrderStore;
  env?: Environment;
  fetchImplementation?: typeof fetch;
  currentBaseBlock: () => Promise<string>;
  verifyReceipt: (order: FundingOrder, hash: `0x${string}`) => Promise<ReceiptMatch>;
  logUnmatchedWebhook?: (event: { providerId: string; reason: "invalid" | "unmatched" }) => void;
  now?: () => Date;
};

export class FundingCore {
  private readonly env: Environment;
  private readonly now: () => Date;
  constructor(private readonly deps: FundingCoreDependencies) {
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? (() => new Date());
  }

  async listProviders(region: string, session: VerifiedAccountSession) {
    const listed = this.deps.providers.flatMap((provider) => provider.manifest.bindings.flatMap((binding) => {
      if (binding.region !== region || !binding.env.every((name) => Boolean(this.env[name]?.trim()))) return [];
      const asset = getFundingAsset(binding.assetId);
      if (!asset) return [];
      return [{ provider, binding, asset }];
    }));
    return Promise.all(listed.map(async ({ provider, binding, asset }) => {
      const existingCustomer = provider.manifest.kyc
        ? await this.deps.store.findCustomerRef(ownerFor(session), provider.manifest.id, binding.region)
        : null;
      return {
        providerId: provider.manifest.id,
        displayName: provider.manifest.displayName,
        region: binding.region,
        assetId: asset.id,
        assetSymbol: asset.symbol,
        assetDecimals: asset.decimals,
        currency: asset.fiatCurrency,
        paymentMethods: binding.paymentMethods,
        quotes: provider.manifest.quotes === true,
        kyc: existingCustomer ? null : provider.manifest.kyc ?? null,
      };
    }));
  }

  async createQuote(session: VerifiedAccountSession, body: unknown) {
    const quoteSecret = this.quoteSecret();
    if (quoteSecret.length < 32) throw new FundingCoreError("FUNDING_NOT_CONFIGURED", 424);
    const parsed = parseQuoteRequest(body);
    const provider = parsed ? this.provider(parsed.providerId) : null;
    const binding = provider?.manifest.bindings.find((candidate) => candidate.region === parsed?.region && candidate.paymentMethods.some((method) => method.id === parsed.paymentMethod));
    const asset = binding ? getFundingAsset(binding.assetId) : null;
    if (!parsed || !provider || !binding || !asset || !session.smartAccount || !binding.env.every((name) => Boolean(this.env[name]?.trim()))) {
      throw new FundingCoreError("INVALID_QUOTE_REQUEST", 400);
    }
    if (parsed.kycFields && !validKycFields(parsed.kycFields, provider.manifest.kyc?.fields ?? [])) {
      throw new FundingCoreError("INVALID_KYC_FIELDS", 400);
    }
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, paymentMethodId: parsed.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation });
    const owner = ownerFor(session);
    let customerRef = await this.deps.store.findCustomerRef(owner, provider.manifest.id, binding.region);
    if (provider.manifest.kyc && !customerRef) {
      if (!provider.ensureCustomer || !parsed.kycFields) throw new FundingCoreError("KYC_REQUIRED", 400);
      customerRef = (await provider.ensureCustomer({ subject: session.user.subject, fields: parsed.kycFields }, ctx)).customerRef;
    }
    const quote = provider.createQuote
      ? await provider.createQuote({ destination: session.smartAccount.address, fiatAmount: parsed.fiatAmount }, ctx)
      : localOneToOneQuote(parsed.fiatAmount, asset.decimals, this.now());
    if (quote.fiatAmount !== parsed.fiatAmount || !validAtomic(quote.tokenAmountAtomic) || Date.parse(quote.expiresAt) <= this.now().getTime()) {
      throw new FundingCoreError("INVALID_PROVIDER_QUOTE", 502);
    }
    const claims = {
      subject: session.user.subject, accountProvider: session.accountProvider,
      providerId: provider.manifest.id, region: binding.region, paymentMethod: parsed.paymentMethod,
      destination: session.smartAccount.address, assetId: asset.id, fiatAmount: parsed.fiatAmount,
      quote, customerRef,
    } as const;
    return { quote, quoteToken: signFundingQuote(claims, quoteSecret) };
  }

  async createOrder(session: VerifiedAccountSession, body: unknown, returnOrigin: string) {
    if (!record(body) || Object.keys(body).length !== 1 || typeof body.quoteToken !== "string" || !session.smartAccount) throw new FundingCoreError("INVALID_ORDER_REQUEST", 400);
    const authenticated = authenticateFundingQuote(body.quoteToken, this.quoteSecret());
    const claims = authenticated?.claims;
    if (!authenticated || !claims || claims.subject !== session.user.subject || claims.accountProvider !== session.accountProvider || claims.destination !== session.smartAccount.address) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const provider = this.provider(claims.providerId);
    const binding = provider?.manifest.bindings.find((candidate) => candidate.region === claims.region && candidate.assetId === claims.assetId && candidate.paymentMethods.some((method) => method.id === claims.paymentMethod));
    if (!provider || !binding || !getFundingAsset(claims.assetId)) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const owner = ownerFor(session);
    const intentDigest = createHash("sha256").update(authenticated.canonicalToken).digest("hex");
    const existing = await this.deps.store.getByIntent(owner, intentDigest);
    if (existing) {
      if (existing.quoteToken !== authenticated.canonicalToken) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
      return publicOrder(existing);
    }
    if (isFundingQuoteExpired(claims, this.now().getTime())) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    if (!binding.env.every((name) => Boolean(this.env[name]?.trim()))) throw new FundingCoreError("PROVIDER_UNAVAILABLE", 424);
    const id = randomUUID();
    const timestamp = this.now().toISOString();
    const reserved = await this.deps.store.reserve({
      id, owner, destination: session.smartAccount.address, providerId: claims.providerId,
      region: claims.region, assetId: claims.assetId, paymentMethod: claims.paymentMethod,
      fiatAmount: claims.fiatAmount, intentDigest,
      quote: claims.quote, quoteToken: authenticated.canonicalToken, customerRef: claims.customerRef,
      creationBlock: await this.deps.currentBaseBlock(), createdAt: timestamp,
    });
    if (!reserved.created) return publicOrder(reserved.order);
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, paymentMethodId: claims.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation });
    const result = await provider.createOrder({ homeOrderId: id, destination: session.smartAccount.address, fiatAmount: claims.fiatAmount, quote: claims.quote, customerRef: claims.customerRef ?? undefined, returnUrl: `${returnOrigin}/fund?return=funding` }, ctx);
    if (result.outcome === "ambiguous") return publicOrder(await this.deps.store.markDispatchAmbiguous(id, reserved.order.version, this.now().toISOString()));
    if (result.outcome === "rejected") {
      const rejected = await this.deps.store.applyObservation(id, { state: "failed", providerStatus: result.message, expectedVersion: reserved.order.version, updatedAt: this.now().toISOString() });
      if (!rejected) throw new FundingCoreError("ORDER_STATE_CHANGED", 409);
      return publicOrder(rejected);
    }
    const asset = getFundingAsset(claims.assetId)!;
    if (result.order.tokenAddress.toLowerCase() !== asset.address.toLowerCase() || result.order.expectedTokenAmountAtomic !== claims.quote.tokenAmountAtomic) {
      // The create reached the provider, so a contradictory echo is an ambiguous
      // dispatch, never a safe rejection that the UI may repeat.
      return publicOrder(await this.deps.store.markDispatchAmbiguous(id, reserved.order.version, this.now().toISOString()));
    }
    return publicOrder(await this.deps.store.completeDispatch(id, { ...result.order, expectedVersion: reserved.order.version, updatedAt: this.now().toISOString() }));
  }

  async getOrder(session: VerifiedAccountSession, id: string) {
    const order = await this.deps.store.getOwned(id, ownerFor(session));
    if (!order) throw new FundingCoreError("ORDER_NOT_FOUND", 404);
    return publicOrder(await this.refresh(order));
  }

  async getOpenOrder(session: VerifiedAccountSession, region: string) {
    const order = await this.deps.store.getOpen(ownerFor(session), region);
    return order ? publicOrder(await this.refresh(order)) : null;
  }

  async handleWebhook(providerId: string, raw: Uint8Array, headers: Headers) {
    const provider = this.provider(providerId);
    if (!provider?.verifyWebhook) return { accepted: true, matched: false };
    let providerOrderId: string | null = null;
    for (const binding of provider.manifest.bindings) {
      if (!binding.env.every((name) => Boolean(this.env[name]?.trim()))) continue;
      for (const method of binding.paymentMethods) {
        const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, paymentMethodId: method.id, env: this.env, fetchImplementation: this.deps.fetchImplementation });
        const verified = provider.verifyWebhook(raw, headers, ctx);
        if (verified) { providerOrderId = verified.providerOrderId; break; }
      }
      if (providerOrderId) break;
    }
    if (!providerOrderId) {
      this.deps.logUnmatchedWebhook?.({ providerId, reason: "invalid" });
      return { accepted: true, matched: false };
    }
    const order = await this.deps.store.getByProviderOrderId(providerId, providerOrderId);
    if (!order) {
      this.deps.logUnmatchedWebhook?.({ providerId, reason: "unmatched" });
      return { accepted: true, matched: false };
    }
    await this.refresh(order, true);
    return { accepted: true, matched: true };
  }

  private async refresh(order: FundingOrder, force = false): Promise<FundingOrder> {
    if (["reserving", "dispatch-ambiguous", "received", "expired", "cancelled", "failed", "refunded"].includes(order.state) || !order.providerOrderId || !order.expectedTokenAmountAtomic) return order;
    if (!force && this.now().getTime() - Date.parse(order.updatedAt) < 3_000) return order;
    const provider = this.provider(order.providerId);
    const binding = provider?.manifest.bindings.find((candidate) => candidate.region === order.region && candidate.assetId === order.assetId && candidate.paymentMethods.some((method) => method.id === order.paymentMethod));
    if (!provider || !binding) return order;
    const asset = getFundingAsset(order.assetId);
    if (!asset) return order;
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, paymentMethodId: order.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation });
    let observation: Observation;
    try {
      observation = await provider.getOrder({
        homeOrderId: order.id,
        providerOrderId: order.providerOrderId,
        providerQuoteId: order.quote.providerQuoteId,
        customerRef: order.customerRef ?? undefined,
        transactionType: "MINT",
        chainId: 8453,
        tokenAddress: asset.address,
        destination: order.destination,
        fiatAmount: order.fiatAmount,
        expectedTokenAmountAtomic: order.expectedTokenAmountAtomic,
        tokenDecimals: asset.decimals,
      }, ctx);
    } catch { return order; }
    const nextState = observation.state === "sent" ? "sent-unverified" : observation.state;
    let updated = await this.deps.store.applyObservation(order.id, {
      state: nextState,
      providerStatus: observation.providerStatus,
      providerTransactionHash: observation.transactionHash,
      expectedVersion: order.version,
      updatedAt: this.now().toISOString(),
    });
    // A concurrent or terminal transition won the compare-and-swap. This stale
    // observation must not claim a receipt or overwrite the winning state.
    if (!updated) return await this.deps.store.getOwned(order.id, order.owner) ?? order;
    if (observation.transactionHash) {
      const evidence = await this.deps.verifyReceipt(updated, observation.transactionHash);
      if (evidence) updated = await this.deps.store.claimReceipt(order.id, { ...evidence, expectedVersion: updated.version, updatedAt: this.now().toISOString() }) ?? updated;
    }
    return updated;
  }

  private provider(id: string) { return this.deps.providers.find((provider) => provider.manifest.id === id); }
  private quoteSecret() { return this.env.FUNDING_QUOTE_SECRET?.trim() ?? ""; }
}

export class FundingCoreError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }

export function publicOrder(order: FundingOrder) {
  return { id: order.id, providerId: order.providerId, region: order.region, assetId: order.assetId, paymentMethod: order.paymentMethod, fiatAmount: order.fiatAmount, quote: order.quote, quoteToken: order.quoteToken, state: order.state, expectedTokenAmountAtomic: order.expectedTokenAmountAtomic, fees: order.fees, expiresAt: order.expiresAt, instructions: order.instructions, providerStatus: order.providerStatus, transactionHash: order.transactionHash, createdAt: order.createdAt, updatedAt: order.updatedAt };
}
function ownerFor(session: VerifiedAccountSession): FundingOrderOwner { return { subject: session.user.subject, accountProvider: session.accountProvider }; }
function localOneToOneQuote(fiatAmount: string, decimals: number, now: Date): Quote { return { fiatAmount, tokenAmountAtomic: decimalToAtomic(fiatAmount, decimals), fees: [], feesKnown: false, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() }; }
function decimalToAtomic(value: string, decimals: number): string { const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value); if (!match || (match[2]?.length ?? 0) > decimals || !/[1-9]/.test(value)) throw new FundingCoreError("INVALID_AMOUNT", 400); return `${match[1]}${(match[2] ?? "").padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, ""); }
function validAtomic(value: string) { return /^(0|[1-9][0-9]*)$/.test(value); }
function parseQuoteRequest(value: unknown): { providerId: string; region: string; paymentMethod: string; fiatAmount: string; kycFields: Record<string, string> | null } | null {
  if (!record(value) || !["providerId", "region", "paymentMethod", "fiatAmount", "kycFields"].every((key) => !(key in value) || key === "kycFields" || typeof value[key] === "string")) return null;
  if (typeof value.providerId !== "string" || typeof value.region !== "string" || typeof value.paymentMethod !== "string" || typeof value.fiatAmount !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value.fiatAmount) || value.fiatAmount.length > 64) return null;
  let kycFields: Record<string, string> | null = null;
  if (value.kycFields !== undefined) { if (!record(value.kycFields) || Object.values(value.kycFields).some((field) => typeof field !== "string" || field.length > 512)) return null; kycFields = value.kycFields as Record<string, string>; }
  return { providerId: value.providerId, region: value.region, paymentMethod: value.paymentMethod, fiatAmount: value.fiatAmount, kycFields };
}
function validKycFields(fields: Record<string, string>, definitions: ReadonlyArray<{ name: string }>): boolean {
  const expected = definitions.map((field) => field.name).sort();
  const supplied = Object.keys(fields).sort();
  return expected.length === supplied.length && expected.every((name, index) => name === supplied[index] && fields[name].trim().length > 0);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
