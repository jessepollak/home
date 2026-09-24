import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { getFundingAsset } from "@/shared/funding/assets";
import type { FundingDirection, FundingProvider, Instruction, Observation, Quote } from "@/shared/funding/provider-contract";
import { decimalToAtomic } from "@/shared/formatting/atomic";
import { FUNDING_BINDING_ENVIRONMENT_CODE, FUNDING_CONFIGURATION_CODE, FundingProviderConfigurationError, createProviderContext, environmentAvailable, resolveFundingMode, type FundingConfigurationCode } from "./provider-context";
import { authenticateFundingQuote, isFundingQuoteExpired, signFundingQuote } from "./quote-token";
import { FundingQuoteRejectedError } from "./quote-rejection";
import { emitFundingProviderFailure } from "./provider-failure";
import type { FundingOrder, FundingOrderOwner, FundingOrderStore } from "./store";
import { MemoryFundingProviderCustomerStore, type FundingProviderCustomer, type FundingProviderCustomerStore } from "./customer-store";
import { awaitBalanceSignal } from "@/server/balances/signal";
import type { FundingUserTokenVault, ProviderUserTokenCreateOrder, FundingUserTokenBinding } from "./provider-user-token";

export const AMBIGUOUS_ORDER_RECOVERY_DELAY_MS = 24 * 60 * 60 * 1_000;

export type ReceiptMatch = { transactionHash: `0x${string}`; logIndex: number } | null;

export type FundingOrderTransitionEvent = {
  route: "/api/funding/orders" | "/api/funding/orders/:id" | "/api/funding/orders/:id/resolve" | "/api/funding/webhooks/:provider";
  code: "ORDER_CREATED" | "ORDER_REJECTED" | "ORDER_AMBIGUOUS" | "ORDER_AMBIGUOUS_RESOLVED" | "ORDER_SENT_UNVERIFIED" | "ORDER_RECEIVED" | "ORDER_EXPIRED" | "ORDER_CANCELLED" | "ORDER_FAILED" | "ORDER_REFUNDED";
  outcome: "ok" | "rejected" | "unavailable" | "failed";
  providerId: string;
  region: string;
  sandbox: boolean;
  durationMs: number;
};

type Environment = Readonly<Record<string, string | undefined>>;
export type FundingCoreDependencies = {
  providers: ReadonlyArray<FundingProvider>;
  store: FundingOrderStore;
  customerStore?: FundingProviderCustomerStore;
  userTokenVault?: FundingUserTokenVault;
  userTokenProviders?: ReadonlyMap<string, ProviderUserTokenCreateOrder>;
  env?: Environment;
  fetchImplementation?: typeof fetch;
  currentBaseBlock: () => Promise<string>;
  verifyReceipt: (order: FundingOrder, hash: `0x${string}`) => Promise<ReceiptMatch>;
  logUnmatchedWebhook?: (event: { providerId: string; reason: "invalid" | "unmatched" | "region-mismatch" }) => void;
  logMatchedWebhook?: (event: { providerId: string; region: string }) => void;
  logProviderDiscoveryFailure?: (event: { providerId: string; reason: "configuration" | "provider"; code: FundingConfigurationCode }) => void;
  logOrderTransition?: (event: FundingOrderTransitionEvent) => void;
  markStale?: (address: `0x${string}`, at: Date) => Promise<void>;
  now?: () => Date;
};

export class FundingCore {
  private readonly env: Environment;
  private readonly now: () => Date;
  private readonly customerStore: FundingProviderCustomerStore;
  constructor(private readonly deps: FundingCoreDependencies) {
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? (() => new Date());
    this.customerStore = deps.customerStore ?? new MemoryFundingProviderCustomerStore();
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
        !directionAvailable(provider, direction, sandbox)
      ) return [];
      if (!environmentAvailable(directional.env, this.env)) {
        this.deps.logProviderDiscoveryFailure?.({
          providerId: provider.manifest.id,
          reason: "configuration",
          code: FUNDING_BINDING_ENVIRONMENT_CODE,
        });
        return [];
      }
      const asset = getFundingAsset(binding.assetId);
      if (!asset) return [];
      return [{ provider, binding, directional, asset, sandbox }];
      });
    });
    let corridorDiscoveryFailed = false;
    const results = await Promise.all(listed.map(async ({ provider, binding, directional, asset, sandbox }) => {
      if (direction === "onramp") {
        const manifest = provider.manifest.onramp;
        if (!manifest || !provider.onramp) return [];
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
          customerSetup: manifest.customer ? { hosted: true as const } : null,
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
        if (!capabilityIsFresh(catalog.asOf, catalog.maxAgeSeconds, this.now())) {
          corridorDiscoveryFailed = true;
          this.deps.logProviderDiscoveryFailure?.({
            providerId: provider.manifest.id,
            reason: "provider",
            code: FUNDING_CONFIGURATION_CODE,
          });
          return [];
        }
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
          customerSetup: null,
        }];
      } catch (error) {
        this.deps.logProviderDiscoveryFailure?.({
          providerId: provider.manifest.id,
          reason: error instanceof FundingProviderConfigurationError ? "configuration" : "provider",
          code: error instanceof FundingProviderConfigurationError ? error.code : FUNDING_CONFIGURATION_CODE,
        });
        corridorDiscoveryFailed = true;
        return [];
      }
    }));
    const providers = results.flat();
    if (providers.length === 0 && corridorDiscoveryFailed) throw new FundingCoreError("PROVIDERS_UNAVAILABLE", 503);
    return providers;
  }

  async listProviderCustomers(session: VerifiedAccountSession, region: string) {
    const customers = await this.customerStore.list(ownerFor(session), region);
    return Promise.all(customers.map(async (customer) => publicCustomer(await this.refreshProviderCustomer(customer))));
  }

  async startProviderCustomerVerification(session: VerifiedAccountSession, body: unknown, returnOrigin: string, headers?: Headers) {
    const parsed = parseVerificationRequest(body);
    const resolved = parsed ? this.customerCapability(parsed.providerId, parsed.region) : null;
    if (!parsed || !resolved) throw new FundingCoreError("INVALID_VERIFICATION_REQUEST", 400);
    const { provider, binding, capability, sandbox } = resolved;
    const timestamp = this.now().toISOString();
    const reserved = await this.customerStore.reserve({ id: randomUUID(), owner: ownerFor(session), providerId: provider.manifest.id, region: binding.region, createdAt: timestamp });
    let customer = reserved.customer;

    if (reserved.created) {
      let result: Awaited<ReturnType<typeof capability.create>>;
      try {
        result = await capability.create({ email: parsed.email }, this.customerContext(resolved));
      } catch {
        result = { outcome: "ambiguous" };
      }
      if (result.outcome === "rejected") {
        const rejected = await this.customerStore.markRejected(customer.id, customer.version, this.now().toISOString());
        return { customer: publicCustomer(rejected ?? customer) };
      }
      if (result.outcome === "ambiguous") {
        const ambiguous = await this.customerStore.markDispatchAmbiguous(customer.id, customer.version, this.now().toISOString());
        return { customer: publicCustomer(ambiguous ?? customer) };
      }
      try {
        const completed = await this.customerStore.completeCreate(customer.id, { customerRef: result.customerRef, expectedVersion: customer.version, updatedAt: this.now().toISOString() });
        if (!completed) throw new Error("customer-create-state-conflict");
        customer = completed;
      } catch {
        const ambiguous = await this.customerStore.markDispatchAmbiguous(customer.id, customer.version, this.now().toISOString());
        return { customer: publicCustomer(ambiguous ?? { ...customer, state: "dispatch-ambiguous" }) };
      }
    } else if (customer.state === "reserving") {
      if (this.now().getTime() - Date.parse(customer.updatedAt) < 120_000) throw new FundingCoreError("CUSTOMER_CREATION_IN_PROGRESS", 409);
      const ambiguous = await this.customerStore.markDispatchAmbiguous(customer.id, customer.version, timestamp);
      return { customer: publicCustomer(ambiguous ?? customer) };
    }

    if (!customer.customerRef || customer.state !== "pending") throw new FundingCoreError("CUSTOMER_NOT_READY", 409);
    if (customer.verificationStartedAt) throw new FundingCoreError("VERIFICATION_ALREADY_STARTED", 409);
    const claimed = await this.customerStore.claimVerification(customer.id, customer.version, this.now().toISOString());
    if (!claimed) throw new FundingCoreError("VERIFICATION_ALREADY_STARTED", 409);
    let result: Awaited<ReturnType<typeof capability.startVerification>>;
    try {
      result = await capability.startVerification({
        customerRef: customer.customerRef,
        clientIp: resolveClientIp(headers, this.env, sandbox),
        redirectUrl: `${returnOrigin}/fund?return=verification`,
      }, this.customerContext(resolved));
    } catch {
      result = { outcome: "ambiguous" };
    }
    if (result.outcome === "rejected") {
      const rejected = await this.customerStore.markRejected(customer.id, claimed.version, this.now().toISOString());
      return { customer: publicCustomer(rejected ?? claimed) };
    }
    if (result.outcome !== "created" || !safeHandoffUrl(result.providerUrl, provider.manifest.onramp?.customer?.handoffOrigins ?? [])) {
      const ambiguous = await this.customerStore.markDispatchAmbiguous(customer.id, claimed.version, this.now().toISOString());
      return { customer: publicCustomer(ambiguous ?? claimed) };
    }
    return { customer: publicCustomer(claimed), handoff: { url: result.providerUrl } };
  }

  private customerCapability(providerId: string, region: string) {
    const provider = this.provider(providerId);
    const binding = provider?.manifest.bindings.find((candidate) => candidate.region === region && candidate.directions.onramp);
    const capability = provider?.onramp?.customer;
    if (!provider || !binding || !capability || !provider.manifest.onramp?.customer || !environmentAvailable(binding.directions.onramp!.env, this.env)) return null;
    const sandbox = resolveFundingMode(provider.manifest, "onramp", this.env) === "sandbox";
    return { provider, binding, capability, sandbox };
  }

  private customerContext(resolved: NonNullable<ReturnType<FundingCore["customerCapability"]>>) {
    return createProviderContext({
      manifest: resolved.provider.manifest,
      region: resolved.binding.region,
      direction: "onramp",
      paymentMethodId: resolved.binding.directions.onramp!.paymentMethods[0]!.id,
      env: this.env,
      fetchImplementation: this.deps.fetchImplementation,
      sandbox: resolved.sandbox,
    });
  }

  private async refreshProviderCustomer(customer: FundingProviderCustomer): Promise<FundingProviderCustomer> {
    if (customer.state !== "pending" || !customer.verificationStartedAt || !customer.customerRef) return customer;
    const resolved = this.customerCapability(customer.providerId, customer.region);
    if (!resolved) return customer;
    let status: "pending" | "verified" | "rejected";
    try {
      status = await resolved.capability.getStatus({ customerRef: customer.customerRef }, this.customerContext(resolved));
    } catch {
      return customer;
    }
    if (status === "verified") {
      return await this.customerStore.markVerified(customer.id, customer.version, this.now().toISOString()) ?? customer;
    }
    if (status === "rejected") {
      return await this.customerStore.markRejected(customer.id, customer.version, this.now().toISOString()) ?? customer;
    }
    return customer;
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
    const minimum = directional.minimumFiatAmount;
    if (minimum !== undefined) {
      const decimals = Math.max(parsed.fiatAmount.split(".")[1]?.length ?? 0, minimum.split(".")[1]?.length ?? 0);
      if (BigInt(decimalToAtomic(parsed.fiatAmount, decimals)) <= BigInt(decimalToAtomic(minimum, decimals))) {
        throw new FundingCoreError("QUOTE_BELOW_MINIMUM", 422, undefined,
          minimumQuoteMessage(provider.manifest.displayName, minimum));
      }
    }
    const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: parsed.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox });
    const customer = onrampManifest.customer
      ? await this.customerStore.get(ownerFor(session), provider.manifest.id, binding.region)
      : null;
    if (onrampManifest.customer && customer?.state !== "verified") {
      throw new FundingCoreError("CUSTOMER_VERIFICATION_REQUIRED", 409);
    }
    const customerRef = customer?.customerRef ?? null;
    let quote: Quote;
    try {
      quote = onramp.createQuote
        ? await onramp.createQuote({
            destination: session.smartAccount.address,
            fiatAmount: parsed.fiatAmount,
            returnUrl: `${returnOrigin}/fund?return=funding`,
            ...(customerRef ? { customerRef } : {}),
          }, ctx)
        : localOneToOneQuote(parsed.fiatAmount, asset.decimals, this.now());
    } catch (error) {
      if (!(error instanceof FundingQuoteRejectedError)) throw error;
      if (error.reason === "below-minimum") {
        throw new FundingCoreError("QUOTE_BELOW_MINIMUM", 422, undefined,
          minimumQuoteMessage(provider.manifest.displayName, minimum));
      }
      throw new FundingCoreError("QUOTE_DECLINED", 422, undefined,
        `${provider.manifest.displayName} couldn't quote this amount. Try a different amount.`);
    }
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
    if (await this.deps.store.getDispatchAmbiguous(owner, claims.region, claims.providerId)) {
      throw new FundingCoreError("AMBIGUOUS_ORDER_OPEN", 409);
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
    const dispatchStartedAt = Date.now();
    const createWithToken = this.deps.userTokenProviders?.get(claims.providerId);
    const tokenBinding: FundingUserTokenBinding | null = createWithToken && this.deps.userTokenVault &&
      claims.subject === owner.subject && claims.accountProvider === owner.accountProvider &&
      claims.destination === session.smartAccount.address && claims.sandbox === sandbox && claims.region === binding.region
      ? { owner, providerId: claims.providerId, region: binding.region, sandbox: claims.sandbox, destination: session.smartAccount.address.toLowerCase() } : null;
    const tokenRead = tokenBinding ? await this.deps.userTokenVault!.readForDispatch(tokenBinding) : null;
    const stored = tokenRead?.credential ?? null;
    const intent = { homeOrderId: id, destination: session.smartAccount.address, fiatAmount: claims.fiatAmount, quote: claims.quote, customerRef: claims.customerRef ?? undefined, clientIp: resolveClientIp(headers, this.env, claims.sandbox), returnUrl: `${returnOrigin}/fund?return=funding` };
    const dispatched = tokenBinding && createWithToken
      ? await createWithToken(intent, { userAuthToken: stored?.token ?? null }, ctx)
      : { result: await onramp.createOrder(intent, ctx), userAuthToken: null, credentialRejected: false };
    const result = dispatched.result;
    if (result.outcome === "ambiguous") {
      const ambiguous = await this.deps.store.markDispatchAmbiguous(id, reserved.order.version, this.now().toISOString());
      this.logTransition(ambiguous, "ORDER_AMBIGUOUS", "unavailable", "/api/funding/orders", dispatchStartedAt);
      return publicOrder(ambiguous);
    }
    if (result.outcome === "rejected") {
      if (tokenBinding && stored && dispatched.credentialRejected) await this.deps.userTokenVault!.clearAfterRejection(tokenBinding, stored);
      const rejected = await this.deps.store.applyObservation(id, { state: "failed", providerStatus: result.message, expectedVersion: reserved.order.version, updatedAt: this.now().toISOString() });
      if (!rejected) throw new FundingCoreError("ORDER_STATE_CHANGED", 409);
      if (rejected.state !== reserved.order.state) this.logTransition(rejected, "ORDER_REJECTED", "rejected", "/api/funding/orders", dispatchStartedAt);
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
      const ambiguous = await this.deps.store.markDispatchAmbiguous(id, reserved.order.version, this.now().toISOString());
      this.logTransition(ambiguous, "ORDER_AMBIGUOUS", "unavailable", "/api/funding/orders", dispatchStartedAt);
      return publicOrder(ambiguous);
    }
    const created = await this.deps.store.completeDispatch(id, { ...result.order, expectedVersion: reserved.order.version, updatedAt: this.now().toISOString() });
    if (tokenBinding && tokenRead && dispatched.userAuthToken) await this.deps.userTokenVault!.capture(tokenBinding, dispatched.userAuthToken, tokenRead.expectedEnvelope);
    this.logTransition(created, "ORDER_CREATED", "ok", "/api/funding/orders", dispatchStartedAt);
    return publicOrder(created);
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

  async resolveAmbiguousOrder(session: VerifiedAccountSession, id: string) {
    const startedAt = Date.now();
    const owner = ownerFor(session);
    const order = await this.deps.store.getOwned(id, owner);
    if (!order) throw new FundingCoreError("ORDER_NOT_FOUND", 404);
    if (order.state !== "dispatch-ambiguous") {
      throw new FundingCoreError("ORDER_NOT_AMBIGUOUS", 409);
    }

    const recoveryAvailableAt = ambiguousOrderRecoveryAvailableAt(order);
    if (this.now().getTime() < recoveryAvailableAt.getTime()) {
      throw new FundingCoreError(
        "ORDER_RESOLUTION_NOT_READY",
        409,
        recoveryAvailableAt.toISOString(),
      );
    }

    const resolved = await this.deps.store.resolveDispatchAmbiguous(
      order.id,
      owner,
      order.version,
      this.now().toISOString(),
    );
    if (!resolved) throw new FundingCoreError("ORDER_STATE_CHANGED", 409);
    this.logTransition(resolved, "ORDER_AMBIGUOUS_RESOLVED", "ok", "/api/funding/orders/:id/resolve", startedAt);
    return publicOrder(resolved);
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
      const verified = verifyWebhookForBinding(() => {
        const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "onramp", paymentMethodId: order.paymentMethod, env: this.env, fetchImplementation: this.deps.fetchImplementation, sandbox: order.sandbox });
        return onramp.verifyWebhook!(raw, headers, ctx);
      });
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
    const refreshStartedAt = Date.now();
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
        expectedTokenAmountAtomic: order.quote.tokenAmountAtomic,
        tokenDecimals: asset.decimals,
      }, ctx);
    } catch { return order; }
    const nextState = observation.state === "sent" ? "sent-unverified" : observation.state;
    const refreshRoute = force ? "/api/funding/webhooks/:provider" : "/api/funding/orders/:id";
    const settled = settledAmount(observation, order.quote.tokenAmountAtomic, order.expectedTokenAmountAtomic);
    if (settled === undefined) {
      emitFundingProviderFailure({
        route: refreshRoute,
        code: "PROVIDER_INVALID_RESPONSE",
        provider: order.providerId,
        region: order.region,
        startedAt: refreshStartedAt,
      });
      return order;
    }
    let updated = await this.deps.store.applyObservation(order.id, {
      state: nextState,
      providerStatus: observation.providerStatus,
      providerTransactionHash: observation.transactionHash,
      ...(settled ? { expectedTokenAmountAtomic: settled, ...(observation.fees ? { fees: observation.fees } : {}) } : {}),
      expectedVersion: order.version,
      updatedAt: this.now().toISOString(),
    });
    if (!updated) return await this.deps.store.getOwned(order.id, order.owner) ?? order;
    if (updated.state !== order.state) this.logObservedTransition(updated, refreshRoute, refreshStartedAt);
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
          this.logTransition(received, "ORDER_RECEIVED", "ok", refreshRoute, refreshStartedAt);
          await awaitBalanceSignal(() => this.deps.markStale?.(
            received.destination,
            receivedAt,
          ), { timeoutMs: 2_000 });
        }
      }
    }
    return updated;
  }

  private logObservedTransition(
    order: FundingOrder,
    route: FundingOrderTransitionEvent["route"],
    startedAt: number,
  ): void {
    const transition = {
      "sent-unverified": ["ORDER_SENT_UNVERIFIED", "unavailable"],
      expired: ["ORDER_EXPIRED", "failed"],
      cancelled: ["ORDER_CANCELLED", "failed"],
      failed: ["ORDER_FAILED", "failed"],
      refunded: ["ORDER_REFUNDED", "failed"],
    } as const;
    const mapped = transition[order.state as keyof typeof transition];
    if (mapped) this.logTransition(order, mapped[0], mapped[1], route, startedAt);
  }

  private logTransition(
    order: FundingOrder,
    code: FundingOrderTransitionEvent["code"],
    outcome: FundingOrderTransitionEvent["outcome"],
    route: FundingOrderTransitionEvent["route"],
    startedAt: number,
  ): void {
    this.deps.logOrderTransition?.({
      route,
      code,
      outcome,
      providerId: order.providerId,
      region: order.region,
      sandbox: order.sandbox,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  }

  private provider(id: string) { return this.deps.providers.find((provider) => provider.manifest.id === id); }
  private quoteSecret() { return this.env.FUNDING_QUOTE_SECRET?.trim() ?? ""; }
}

function settledAmount(observation: Observation, quoted: string, current: string): string | null | undefined {
  const reported = observation.settledTokenAmountAtomic;
  if (reported === undefined) return null;
  if (!/^[1-9][0-9]{0,77}$/.test(reported)) return undefined;
  if (BigInt(reported) > BigInt(quoted)) return undefined;
  if (current !== quoted) return reported === current ? null : undefined;
  return reported === quoted ? null : reported;
}

export function ambiguousOrderRecoveryAvailableAt(
  order: Pick<FundingOrder, "updatedAt" | "quote">,
): Date {
  const updatedAt = Date.parse(order.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    throw new FundingCoreError("ORDER_RECOVERY_TIME_INVALID", 503);
  }
  const quoteExpiresAt = Date.parse(order.quote.expiresAt);
  const boundary = Number.isFinite(quoteExpiresAt)
    ? Math.max(updatedAt, quoteExpiresAt)
    : updatedAt;
  const availableAt = new Date(boundary + AMBIGUOUS_ORDER_RECOVERY_DELAY_MS);
  if (!Number.isFinite(availableAt.getTime())) {
    throw new FundingCoreError("ORDER_RECOVERY_TIME_INVALID", 503);
  }
  return availableAt;
}

function minimumQuoteMessage(displayName: string, minimum?: string): string {
  if (!minimum) return `This amount is below ${displayName}'s minimum. Enter a larger amount.`;
  const formattedMinimum = minimum.includes(".") ? minimum.replace(/0+$/, "").replace(/\.$/, "") : minimum;
  return `${displayName} needs more than $${formattedMinimum} after fees. Enter a larger amount.`;
}

export class FundingCoreError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly availableAt?: string,
    readonly publicMessage?: string,
  ) {
    super(code);
  }
}

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
function verifyWebhookForBinding(
  verify: () => { providerOrderId: string } | null,
): { providerOrderId: string } | null {
  try {
    return verify();
  } catch (error) {
    if (error instanceof FundingProviderConfigurationError) return null;
    throw error;
  }
}
function parseQuoteRequest(value: unknown): { providerId: string; region: string; paymentMethod: string; fiatAmount: string } | null {
  if (!record(value) || Object.keys(value).some((key) => !["providerId", "region", "paymentMethod", "fiatAmount"].includes(key))) return null;
  if (typeof value.providerId !== "string" || typeof value.region !== "string" || typeof value.paymentMethod !== "string" || typeof value.fiatAmount !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value.fiatAmount) || value.fiatAmount.length > 64) return null;
  return { providerId: value.providerId, region: value.region, paymentMethod: value.paymentMethod, fiatAmount: value.fiatAmount };
}
function parseVerificationRequest(value: unknown): { providerId: string; region: string; email: string } | null {
  if (!record(value) || Object.keys(value).some((key) => !["providerId", "region", "email"].includes(key)) || typeof value.providerId !== "string" || typeof value.region !== "string" || typeof value.email !== "string") return null;
  const email = value.email.trim();
  return email.length > 3 && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { providerId: value.providerId, region: value.region, email } : null;
}
function publicCustomer(customer: FundingProviderCustomer) {
  return { providerId: customer.providerId, region: customer.region, state: customer.state, verificationStartedAt: customer.verificationStartedAt, updatedAt: customer.updatedAt };
}
function safeHandoffUrl(value: string, origins: ReadonlyArray<string>): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && origins.includes(url.origin) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function clientIpFromHeaders(headers: Headers | undefined): string | undefined {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers?.get("x-real-ip")?.trim();
  return candidate && /^[0-9a-f.:]{2,45}$/i.test(candidate) ? candidate : undefined;
}
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
