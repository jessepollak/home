import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { getFundingAsset } from "@/shared/funding/assets";
import type { FundingDirection, FundingProvider, Instruction, Observation, Quote } from "@/shared/funding/provider-contract";
import { decimalToAtomic } from "@/shared/formatting/atomic";
import { FUNDING_CONFIGURATION_CODE, FundingProviderConfigurationError, createProviderContext, environmentAvailable, resolveFundingMode, type FundingConfigurationCode } from "./provider-context";
import { authenticateFundingQuote, isFundingQuoteExpired, signFundingQuote } from "./quote-token";
import type { FundingOrder, FundingOrderOwner, FundingOrderStore } from "./store";
import { awaitBalanceSignal } from "@/server/balances/signal";

export type ReceiptMatch = { transactionHash: `0x${string}`; logIndex: number } | null;

type Environment = Readonly<Record<string, string | undefined>>;
export type FundingCoreDependencies = {
  providers: ReadonlyArray<FundingProvider>;
  store: FundingOrderStore;
  env?: Environment;
  fetchImplementation?: typeof fetch;
  currentBaseBlock: () => Promise<string>;
  verifyReceipt: (order: FundingOrder, hash: `0x${string}`) => Promise<ReceiptMatch>;
  logUnmatchedWebhook?: (event: { providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }) => void;
  logMatchedWebhook?: (event: { providerId: string; region: string }) => void;
  logProviderDiscoveryFailure?: (event: { providerId: string; reason: "configuration" | "provider"; code: FundingConfigurationCode }) => void;
  markStale?: (address: `0x${string}`, at: Date) => Promise<void>;
  now?: () => Date;
};

export class FundingCore {
  private readonly env: Environment;
  private readonly now: () => Date;
  constructor(private readonly deps: FundingCoreDependencies) {
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? (() => new Date());
  }

  async listProviders(
    region: string,
    session: VerifiedAccountSession,
    direction: FundingDirection = "onramp",
  ) {
    const listed = this.deps.providers.flatMap((provider) => {
      let sandbox: boolean;
      try {
        sandbox = resolveFundingMode(provider.manifest, direction, this.env) === "sandbox";
      } catch (error) {
        this.deps.logProviderDiscoveryFailure?.({
          providerId: provider.manifest.id,
          reason: "configuration",
          code: error instanceof FundingProviderConfigurationError ? error.code : FUNDING_CONFIGURATION_CODE,
        });
        return [];
      }
      return provider.manifest.bindings.flatMap((binding) => {
      const directional = binding.directions[direction];
      if (
        binding.region !== region ||
        !directional ||
        !(direction === "onramp" ? provider.onramp : provider.offramp) ||
        !directionAvailable(provider, direction, sandbox) ||
        !environmentAvailable(directional.env, this.env)
      ) return [];
      const asset = getFundingAsset(binding.assetId);
      if (!asset) return [];
      return [{ provider, binding, directional, asset, sandbox }];
      });
    });
    const results = await Promise.all(listed.map(async ({ provider, binding, directional, asset, sandbox }) => {
      if (direction === "onramp") {
        const manifest = provider.manifest.onramp;
        if (!manifest || !provider.onramp) return [];
        const existingCustomer = manifest.kyc
          ? await this.deps.store.findCustomerRef(ownerFor(session), provider.manifest.id, binding.region)
          : null;
        return [{
          direction,
          providerId: provider.manifest.id,
          displayName: provider.manifest.displayName,
          region: binding.region,
          assetId: asset.id,
          assetSymbol: asset.symbol,
          assetDecimals: asset.decimals,
          currency: binding.currency,
          paymentMethods: directional.paymentMethods,
          quotes: manifest.quotes === true,
          kyc: existingCustomer ? null : manifest.kyc ?? null,
        }];
      }
      if (!provider.offramp || !session.smartAccount) return [];
      try {
        const firstMethod = directional.paymentMethods[0];
        if (!firstMethod) return [];
        const ctx = createProviderContext({
          manifest: provider.manifest,
          region: binding.region,
          direction: "offramp",
          paymentMethodId: firstMethod.id,
          env: this.env,
          fetchImplementation: this.deps.fetchImplementation,
          sandbox,
        });
        const catalog = await provider.offramp.capabilities(ctx);
        if (!capabilityIsFresh(catalog.asOf, catalog.maxAgeSeconds, this.now())) return [];
        const platforms = directional.paymentMethods.flatMap((method) => {
          const capability = catalog.platforms.find((candidate) => candidate.id === method.id);
          if (!capability || !capability.currencies.includes(binding.currency)) return [];
          return [{
            id: method.id,
            label: method.label,
            platform: capability.id,
            handleHint: capability.handleHint,
            minimumAmountAtomic: capability.minimumAmountAtomic,
            maximumAmountAtomic: capability.maximumAmountAtomic,
            estimateSemantics: capability.estimateSemantics,
            etaSemantics: capability.etaSemantics,
            corridorConfirmedBy: "confirmedBy" in directional ? directional.confirmedBy : "",
          }];
        });
        if (platforms.length === 0) return [];
        return [{
          direction,
          providerId: provider.manifest.id,
          displayName: provider.manifest.displayName,
          region: binding.region,
          assetId: asset.id,
          assetSymbol: asset.symbol,
          assetDecimals: asset.decimals,
          currency: binding.currency,
          paymentMethods: platforms,
          quotes: false,
          kyc: null,
        }];
      } catch (error) {
        this.deps.logProviderDiscoveryFailure?.({
          providerId: provider.manifest.id,
          reason: error instanceof FundingProviderConfigurationError ? "configuration" : "provider",
          code: error instanceof FundingProviderConfigurationError ? error.code : FUNDING_CONFIGURATION_CODE,
        });
        return [];
      }
    }));
    return results.flat();
  }

  async createQuote(
    session: VerifiedAccountSession,
    body: unknown,
    returnOrigin: string,
  ) {
    const quoteSecret = this.quoteSecret();
    if (quoteSecret.length < 32) throw new FundingCoreError("FUNDING_NOT_CONFIGURED", 424);
    const parsed = parseQuoteRequest(body);
    const provider = parsed ? this.provider(parsed.providerId) : null;
    const binding = provider && parsed ? findBinding(provider, parsed.region, "onramp", parsed.paymentMethod) : null;
    const asset = binding ? getFundingAsset(binding.assetId) : null;
    const sandbox = provider ? resolveFundingMode(provider.manifest, "onramp", this.env) === "sandbox" : false;
    const onramp = provider ? provider.onramp : null;
    const onrampManifest = provider?.manifest.onramp;
    const directional = binding?.directions.onramp;
    if (!parsed || !provider || !binding || !directional || !asset || !onramp || !onrampManifest || !session.smartAccount || !directionAvailable(provider, "onramp", sandbox) || !environmentAvailable(directional.env, this.env) || (!onramp.createQuote && binding.currency !== asset.fiatCurrency)) {
      throw new FundingCoreError("INVALID_QUOTE_REQUEST", 400);
    }
    if (parsed.kycFields && !validKycFields(parsed.kycFields, onrampManifest.kyc?.fields ?? [])) {
      throw new FundingCoreError("INVALID_KYC_FIELDS", 400);
    }
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: parsed.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox });
    const owner = ownerFor(session);
    let customerRef = await this.deps.store.findCustomerRef(owner, provider.manifest.id, binding.region);
    if (onrampManifest.kyc && !customerRef) {
      if (!onramp.ensureCustomer || !parsed.kycFields) throw new FundingCoreError("KYC_REQUIRED", 400);
      customerRef = (await onramp.ensureCustomer({ subject: session.user.subject, fields: parsed.kycFields }, ctx)).customerRef;
    }
    const quote: Quote = onramp.createQuote
      ? await onramp.createQuote({
          destination: session.smartAccount.address,
          fiatAmount: parsed.fiatAmount,
          returnUrl: `${returnOrigin}/fund?return=funding`,
        }, ctx)
      : localOneToOneQuote(parsed.fiatAmount, asset.decimals, this.now());
    if (quote.fiatAmount !== parsed.fiatAmount || !validAtomic(quote.tokenAmountAtomic) || Date.parse(quote.expiresAt) <= this.now().getTime()) {
      throw new FundingCoreError("INVALID_PROVIDER_QUOTE", 502);
    }
    const claims = {
      subject: session.user.subject, accountProvider: session.accountProvider,
      providerId: provider.manifest.id, region: binding.region, paymentMethod: parsed.paymentMethod,
      destination: session.smartAccount.address, assetId: asset.id, fiatAmount: parsed.fiatAmount,
      quote, customerRef, sandbox,
    } as const;
    return { quote, quoteToken: signFundingQuote(claims, quoteSecret), sandbox };
  }

  async createOrder(
    session: VerifiedAccountSession,
    body: unknown,
    returnOrigin: string,
    headers?: Headers,
  ) {
    if (!record(body) || Object.keys(body).length !== 1 || typeof body.quoteToken !== "string" || !session.smartAccount) throw new FundingCoreError("INVALID_ORDER_REQUEST", 400);
    const authenticated = authenticateFundingQuote(body.quoteToken, this.quoteSecret());
    const claims = authenticated?.claims;
    if (!authenticated || !claims || claims.subject !== session.user.subject || claims.accountProvider !== session.accountProvider || claims.destination !== session.smartAccount.address) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const provider = this.provider(claims.providerId);
    const binding = provider ? findBinding(provider, claims.region, "onramp", claims.paymentMethod, claims.assetId) : null;
    const onramp = provider ? provider.onramp : null;
    if (!provider || !onramp || !binding || !getFundingAsset(claims.assetId)) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const sandbox = resolveFundingMode(provider.manifest, "onramp", this.env) === "sandbox";
    if (claims.sandbox !== sandbox) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const owner = ownerFor(session);
    const intentDigest = createHash("sha256").update(authenticated.canonicalToken).digest("hex");
    const existing = await this.deps.store.getByIntent(owner, intentDigest);
    if (existing) {
      if (existing.quoteToken !== authenticated.canonicalToken) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
      return publicOrder(existing);
    }
    if (isFundingQuoteExpired(claims, this.now().getTime())) throw new FundingCoreError("INVALID_QUOTE_TOKEN", 400);
    const directional = binding.directions.onramp;
    if (!directional || !environmentAvailable(directional.env, this.env)) throw new FundingCoreError("PROVIDER_UNAVAILABLE", 424);
    const id = randomUUID();
    const timestamp = this.now().toISOString();
    const reserved = await this.deps.store.reserve({
      id, owner, destination: session.smartAccount.address, providerId: claims.providerId,
      region: claims.region, assetId: claims.assetId, paymentMethod: claims.paymentMethod,
      fiatAmount: claims.fiatAmount, intentDigest,
      quote: claims.quote, quoteToken: authenticated.canonicalToken, customerRef: claims.customerRef,
      sandbox: claims.sandbox, creationBlock: await this.deps.currentBaseBlock(), createdAt: timestamp,
    });
    if (!reserved.created) return publicOrder(reserved.order);
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: claims.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox: claims.sandbox });
    const result = await onramp.createOrder({ homeOrderId: id, destination: session.smartAccount.address, fiatAmount: claims.fiatAmount, quote: claims.quote, customerRef: claims.customerRef ?? undefined, clientIp: resolveClientIp(headers, this.env, claims.sandbox), returnUrl: `${returnOrigin}/fund?return=funding` }, ctx);
    if (result.outcome === "ambiguous") return publicOrder(await this.deps.store.markDispatchAmbiguous(id, reserved.order.version, this.now().toISOString()));
    if (result.outcome === "rejected") {
      const rejected = await this.deps.store.applyObservation(id, { state: "failed", providerStatus: result.message, expectedVersion: reserved.order.version, updatedAt: this.now().toISOString() });
      if (!rejected) throw new FundingCoreError("ORDER_STATE_CHANGED", 409);
      return publicOrder(rejected);
    }
    const asset = getFundingAsset(claims.assetId)!;
    if (
      result.order.tokenAddress.toLowerCase() !== asset.address.toLowerCase() ||
      result.order.expectedTokenAmountAtomic !== claims.quote.tokenAmountAtomic ||
      !instructionUrlIsSafe(
        result.order.instructions,
        provider.manifest.onramp?.redirectOrigins,
      )
    ) {
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
    const onramp = provider ? provider.onramp : null;
    if (!provider || !onramp?.verifyWebhook) return { accepted: true, matched: false };
    let providerOrderId: string | null = null;
    let verifiedRegion: FundingOrder["region"] | null = null;
    for (const binding of provider.manifest.bindings) {
      const directional = binding.directions.onramp;
      if (!directional || !environmentAvailable(directional.env, this.env)) continue;
      for (const method of directional.paymentMethods) {
        try {
          const sandbox = resolveFundingMode(provider.manifest, "onramp", this.env) === "sandbox";
          const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: method.id, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox });
          const verified = onramp.verifyWebhook(raw, headers, ctx);
          if (verified) {
            providerOrderId = verified.providerOrderId;
            verifiedRegion = binding.region;
            break;
          }
        } catch (error) {
          if (!(error instanceof FundingProviderConfigurationError)) throw error;
          // A webhook is only a trigger. Invalid binding configuration cannot
          // turn an unverified request into an order refresh.
        }
      }
      if (providerOrderId) break;
    }
    if (!providerOrderId || !verifiedRegion) {
      this.deps.logUnmatchedWebhook?.({ providerId, reason: "invalid" });
      return { accepted: true, matched: false };
    }
    const order = await this.deps.store.getByProviderOrderId(providerId, providerOrderId);
    if (!order) {
      this.deps.logUnmatchedWebhook?.({ providerId, reason: "unmatched" });
      return { accepted: true, matched: false };
    }
    if (order.region !== verifiedRegion) {
      const binding = findBinding(provider, order.region, "onramp", order.paymentMethod, order.assetId);
      if (!binding || !environmentAvailable(binding.directions.onramp!.env, this.env)) {
        this.deps.logUnmatchedWebhook?.({ providerId, reason: "region-mismatch" });
        return { accepted: true, matched: false };
      }
      let verified;
      try {
        const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: order.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox: order.sandbox });
        verified = onramp.verifyWebhook(raw, headers, ctx);
      } catch (error) {
        if (!(error instanceof FundingProviderConfigurationError)) throw error;
      }
      if (verified?.providerOrderId !== providerOrderId) {
        this.deps.logUnmatchedWebhook?.({ providerId, reason: "region-mismatch" });
        return { accepted: true, matched: false };
      }
      verifiedRegion = order.region;
    }
    this.deps.logMatchedWebhook?.({ providerId, region: verifiedRegion });
    await this.refresh(order, true);
    return { accepted: true, matched: true };
  }

  private async refresh(order: FundingOrder, force = false): Promise<FundingOrder> {
    if (["reserving", "dispatch-ambiguous", "received", "expired", "cancelled", "failed", "refunded"].includes(order.state) || !order.providerOrderId || !order.expectedTokenAmountAtomic) return order;
    if (!force && this.now().getTime() - Date.parse(order.updatedAt) < 3_000) return order;
    const provider = this.provider(order.providerId);
    const binding = provider ? findBinding(provider, order.region, "onramp", order.paymentMethod, order.assetId) : null;
    const onramp = provider ? provider.onramp : null;
    if (!provider || !onramp || !binding) return order;
    const asset = getFundingAsset(order.assetId);
    if (!asset) return order;
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: order.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox: order.sandbox });
    let observation: Observation;
    try {
      observation = await onramp.getOrder({
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
    if (observation.transactionHash && !order.sandbox) {
      const evidence = await this.deps.verifyReceipt(updated, observation.transactionHash);
      if (evidence) {
        const receivedAt = this.now();
        const received = await this.deps.store.claimReceipt(order.id, {
          ...evidence,
          expectedVersion: updated.version,
          updatedAt: receivedAt.toISOString(),
        });
        if (received) {
          updated = received;
          await awaitBalanceSignal(() => this.deps.markStale?.(
            received.destination,
            receivedAt,
          ), { timeoutMs: 2_000 });
        }
      }
    }
    return updated;
  }

  private provider(id: string) { return this.deps.providers.find((provider) => provider.manifest.id === id); }
  private quoteSecret() { return this.env.FUNDING_QUOTE_SECRET?.trim() ?? ""; }
}

export class FundingCoreError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }

export function publicOrder(order: FundingOrder) {
  return { id: order.id, providerId: order.providerId, region: order.region, assetId: order.assetId, paymentMethod: order.paymentMethod, fiatAmount: order.fiatAmount, quote: order.quote, quoteToken: order.quoteToken, sandbox: order.sandbox, state: order.state, expectedTokenAmountAtomic: order.expectedTokenAmountAtomic, fees: order.fees, expiresAt: order.expiresAt, instructions: order.instructions, providerStatus: order.providerStatus, transactionHash: order.transactionHash, createdAt: order.createdAt, updatedAt: order.updatedAt };
}
function ownerFor(session: VerifiedAccountSession): FundingOrderOwner { return { subject: session.user.subject, accountProvider: session.accountProvider }; }
function findBinding(
  provider: FundingProvider,
  region: string,
  direction: FundingDirection,
  paymentMethodId: string,
  assetId?: string,
) {
  const matches = provider.manifest.bindings.filter((binding) =>
    binding.region === region &&
    (!assetId || binding.assetId === assetId) &&
    binding.directions[direction]?.paymentMethods.some((method) => method.id === paymentMethodId),
  );
  return matches.length === 1 ? matches[0] : null;
}
function directionAvailable(provider: FundingProvider, direction: FundingDirection, sandbox: boolean): boolean {
  if (direction === "onramp") return Boolean(provider.manifest.onramp && (!sandbox || provider.manifest.onramp.sandbox === true));
  return Boolean(sandbox ? provider.manifest.offramp?.sandbox : provider.manifest.offramp?.production);
}
function capabilityIsFresh(asOf: string, maxAgeSeconds: number, now: Date): boolean {
  const timestamp = Date.parse(asOf);
  return Number.isFinite(timestamp) && Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds > 0 && timestamp <= now.getTime() && now.getTime() - timestamp <= maxAgeSeconds * 1_000;
}
function localOneToOneQuote(fiatAmount: string, decimals: number, now: Date): Quote {
  try {
    if (!/[1-9]/.test(fiatAmount)) throw new Error("Amount must be positive.");
    return { fiatAmount, tokenAmountAtomic: decimalToAtomic(fiatAmount, decimals), fees: [], feesKnown: false, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() };
  } catch {
    throw new FundingCoreError("INVALID_AMOUNT", 400);
  }
}
function validAtomic(value: string) { return /^(0|[1-9][0-9]*)$/.test(value); }
function instructionUrlIsSafe(
  instruction: Instruction,
  redirectOrigins: ReadonlyArray<string> | undefined,
): boolean {
  if (instruction.kind !== "redirect" && instruction.kind !== "embed") return true;
  if (
    instruction.url.length > 4096 ||
    !redirectOrigins?.length ||
    (instruction.kind === "embed" && (
      !/^(0|[1-9]\d*)(\.\d+)?$/.test(instruction.amount) ||
      !/^[A-Z]{3}$/.test(instruction.currency)
    ))
  ) return false;
  try {
    const url = new URL(instruction.url);
    return (
      url.protocol === "https:" &&
      redirectOrigins.includes(url.origin) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}
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
function clientIpFromHeaders(headers: Headers | undefined): string | undefined {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers?.get("x-real-ip")?.trim();
  return candidate && /^[0-9a-f.:]{2,45}$/i.test(candidate) ? candidate : undefined;
}
// Providers that need the end user's public IP reject loopback and private
// ranges. A local sandbox run has only those, so sandbox mode alone may
// substitute FUNDING_SANDBOX_CLIENT_IP; production never reads it.
export function resolveClientIp(headers: Headers | undefined, env: Environment, sandbox: boolean): string | undefined {
  const observed = clientIpFromHeaders(headers);
  if (!sandbox) return observed;
  const override = env.FUNDING_SANDBOX_CLIENT_IP?.trim();
  if (override && (!observed || isPrivateIp(observed))) return override;
  return observed;
}
const PRIVATE_IP = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.0\.0\.0$|::(?:1)?$|(?:0{1,4}:){7}0{1,4}$|::ffff:(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.0\.0\.0$)|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
export function isPrivateIp(value: string): boolean { return PRIVATE_IP.test(value.trim()); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
