import "server-only";

import {
  exactRipioEntitlement,
  RIPIO_ASSETS,
  type RipioCountry,
  type RipioEnabledCountry,
  type RipioQuote,
  type RipioQuoteRequest,
  type RipioRailInstructions,
} from "@/shared/funding/ripio-contract";

const RIPIO_PRODUCTION_ORIGIN = "https://skala.ripio.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Environment = Record<string, string | undefined>;
type RipioFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RipioProviderError extends Error {
  readonly code:
    | "not-configured"
    | "invalid-request"
    | "unauthorized"
    | "unavailable"
    | "invalid-response"
    | "ambiguous-create";
  readonly status: number | null;

  constructor(code: RipioProviderError["code"], status: number | null = null, cause?: unknown) {
    super(code, { cause });
    this.name = "RipioProviderError";
    this.code = code;
    this.status = status;
  }
}

export type RipioCustomerReference = {
  customerId: string;
  createdAt: string;
};

export type RipioTransactionReference = {
  transactionId: string;
  customerId: string;
  quoteId: string;
  externalRef: string;
  status: string;
  txnHash: string | null;
  operationType: "ON_RAMP";
  fromCurrency: string;
  toCurrency: string;
  chain: string;
  destination: `0x${string}`;
  paymentMethodType: string;
  finalToAmount: string;
  latestRefund: { status: string; rejectionReason: string | null } | null;
};

export type RipioOrderReference = RipioTransactionReference & {
  instructions: RipioRailInstructions;
};

export type RipioClient = {
  createCustomer(input: { email: string }): Promise<RipioCustomerReference>;
  createQuote(input: RipioQuoteRequest): Promise<RipioQuote>;
  createOnramp(input: {
    customerId: string;
    quoteId: string;
    externalRef: string;
    destination: `0x${string}`;
    fromCurrency: string;
    toCurrency: string;
    chain: "BASE";
    paymentMethodType: string;
    finalToAmount: string;
    extraData?: Record<string, string>;
  }): Promise<RipioOrderReference>;
  getTransaction(transactionId: string): Promise<RipioTransactionReference>;
  getCustomer(customerId: string): Promise<unknown>;
  getTerms(): Promise<unknown>;
  acceptTerms(customerId: string, termsId: string): Promise<unknown>;
  submitKyc(customerId: string, body: Record<string, unknown>): Promise<unknown>;
  getDepositNetworks(): Promise<unknown>;
  getWithdrawalNetworks(): Promise<unknown>;
};

export function createRipioClient(country: RipioCountry, options: {
  env?: Environment;
  fetchImplementation?: RipioFetch;
  now?: () => number;
} = {}): RipioClient {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  const clientId = env[`RIPIO_CLIENT_ID_${country}`]?.trim();
  const clientSecret = env[`RIPIO_CLIENT_SECRET_${country}`]?.trim();
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (!clientId || !clientSecret) throw new RipioProviderError("not-configured");
    if (cachedToken && cachedToken.expiresAt - 60_000 > now()) return cachedToken.value;
    let response: Response;
    try {
      response = await fetchImplementation(`${RIPIO_PRODUCTION_ORIGIN}/oauth2/token/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
    } catch (error) {
      throw new RipioProviderError("unavailable", null, error);
    }
    if (response.status === 401 || response.status === 403) {
      throw new RipioProviderError("unauthorized", response.status);
    }
    if (!response.ok) throw new RipioProviderError("unavailable", response.status);
    const value = await readJson(response);
    if (
      !isRecord(value) ||
      typeof value.access_token !== "string" ||
      value.access_token.length < 16 ||
      typeof value.expires_in !== "number" ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    ) throw new RipioProviderError("invalid-response", response.status);
    cachedToken = {
      value: value.access_token,
      expiresAt: now() + Math.min(value.expires_in, 36_000) * 1_000,
    };
    return cachedToken.value;
  }

  async function request(path: string, init: RequestInit = {}, create = false): Promise<unknown> {
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetchImplementation(`${RIPIO_PRODUCTION_ORIGIN}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      // A timed-out or disconnected create can have succeeded. It must be reconciled by
      // a recorded provider ID or GET, never by repeating the POST.
      throw new RipioProviderError(create ? "ambiguous-create" : "unavailable", null, error);
    }
    if (response.status === 401 || response.status === 403) {
      cachedToken = null;
      throw new RipioProviderError("unauthorized", response.status);
    }
    if (!response.ok) {
      throw new RipioProviderError(
        create && response.status >= 500 ? "ambiguous-create" : response.status < 500 ? "invalid-request" : "unavailable",
        response.status,
      );
    }
    return readJson(response);
  }

  return {
    async createCustomer(input) {
      if (!validEmail(input.email)) throw new RipioProviderError("invalid-request");
      return parseCreateResponse(
        () => request("/api/v1/customers/", {
          method: "POST",
          body: JSON.stringify({ email: input.email, type: "INDIVIDUAL" }),
        }, true),
        parseCustomer,
      );
    },
    async createQuote(input) {
      if (country === "BR" || input.country !== country || !exactRipioEntitlement(input)) {
        throw new RipioProviderError("invalid-request");
      }
      const depositCatalog = await request("/api/v1/depositNetworks/?include_currency=true");
      const withdrawalCatalog = await request("/api/v1/withdrawalNetworks/?include_currency=true");
      if (!catalogEntitles(depositCatalog, country) || !catalogEntitles(withdrawalCatalog, country)) {
        throw new RipioProviderError("invalid-request");
      }
      const providerInput = {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        fromAmount: input.fromAmount,
        chain: input.chain,
        paymentMethodType: input.paymentMethodType,
      };
      return parseCreateResponse(
        () => request("/api/v1/quotes/", {
          method: "POST",
          body: JSON.stringify(providerInput),
        }, true),
        (value) => parseQuote(value, input),
      );
    },
    async createOnramp(input) {
      if (country === "BR" || ![input.customerId, input.quoteId, input.externalRef].every(validUuid) || !validAddress(input.destination)) {
        throw new RipioProviderError("invalid-request");
      }
      return parseCreateResponse(
        () => request("/api/v1/onramp/", {
          method: "POST",
          body: JSON.stringify({
            customerId: input.customerId,
            quoteId: input.quoteId,
            depositAddress: input.destination,
            externalRef: input.externalRef,
            ...(input.extraData ? { extraData: input.extraData } : {}),
          }),
        }, true),
        (value) => parseOrder(value, country as RipioEnabledCountry, input),
      );
    },
    async getTransaction(transactionId) {
      if (!validUuid(transactionId)) throw new RipioProviderError("invalid-request");
      return parseTransaction(await request(`/api/v1/transactions/${encodeURIComponent(transactionId)}/`));
    },
    async getCustomer(customerId) {
      if (!validUuid(customerId)) throw new RipioProviderError("invalid-request");
      return request(`/api/v1/customers/${customerId}/`);
    },
    getTerms: () => request("/api/v1/termsAndConditions/"),
    acceptTerms(customerId, termsId) {
      if (!validUuid(customerId) || !validUuid(termsId)) throw new RipioProviderError("invalid-request");
      return request(`/api/v1/customers/${customerId}/acceptTerms/`, { method: "POST", body: JSON.stringify({ termsId }) }, true);
    },
    submitKyc(customerId, body) {
      if (!validUuid(customerId) || !isRecord(body)) throw new RipioProviderError("invalid-request");
      return request(`/api/v1/customers/${customerId}/kyc/`, { method: "POST", body: JSON.stringify(body) }, true);
    },
    getDepositNetworks: () => request("/api/v1/depositNetworks/?include_currency=true"),
    getWithdrawalNetworks: () => request("/api/v1/withdrawalNetworks/?include_currency=true"),
  };
}

export function ripioCredentialState(country: RipioCountry, env: Environment = process.env): "configured" | "missing" | "partial" {
  const id = Boolean(env[`RIPIO_CLIENT_ID_${country}`]?.trim());
  const secret = Boolean(env[`RIPIO_CLIENT_SECRET_${country}`]?.trim());
  return id && secret ? "configured" : id || secret ? "partial" : "missing";
}

function parseCustomer(value: unknown): RipioCustomerReference {
  if (!isRecord(value) || !validUuid(value.customerId) || !validDate(value.createdAt)) {
    throw new RipioProviderError("invalid-response");
  }
  return { customerId: value.customerId, createdAt: value.createdAt };
}

function parseQuote(value: unknown, request: RipioQuoteRequest): RipioQuote {
  if (!isRecord(value) || !validUuid(value.quoteId) || value.fromCurrency !== request.fromCurrency || value.toCurrency !== request.toCurrency || !validDate(value.expiration) || !Array.isArray(value.fees)) {
    throw new RipioProviderError("invalid-response");
  }
  const decimalFields = ["fromAmount", "finalFromAmount", "toAmount", "finalToAmount", "rate"] as const;
  if (decimalFields.some((field) => !validDecimal(value[field]))) throw new RipioProviderError("invalid-response");
  const fees = value.fees.map((fee) => {
    if (!isRecord(fee) || !validDecimal(fee.amount) || typeof fee.type !== "string" || typeof fee.currency !== "string" || typeof fee.appliesOnFromAmount !== "boolean" || typeof fee.appliesOnToAmount !== "boolean") throw new RipioProviderError("invalid-response");
    return { amount: fee.amount, type: fee.type, currency: fee.currency, appliesOnFromAmount: fee.appliesOnFromAmount, appliesOnToAmount: fee.appliesOnToAmount };
  });
  return { quoteId: value.quoteId, fromCurrency: request.fromCurrency, toCurrency: request.toCurrency, fromAmount: value.fromAmount as string, finalFromAmount: value.finalFromAmount as string, toAmount: value.toAmount as string, finalToAmount: value.finalToAmount as string, rate: value.rate as string, expiration: value.expiration, fees };
}

type ExpectedOrderBinding = Parameters<RipioClient["createOnramp"]>[0];

function parseOrder(value: unknown, country: RipioEnabledCountry, expected: ExpectedOrderBinding): RipioOrderReference {
  if (!isRecord(value) || !isRecord(value.transaction) || !isRecord(value.fiatPaymentInstructions)) throw new RipioProviderError("invalid-response");
  const transaction = parseTransaction(value.transaction);
  assertTransactionBinding(transaction, expected);
  return { ...transaction, instructions: parseInstructions(value.fiatPaymentInstructions, country) };
}

function parseTransaction(value: unknown): RipioTransactionReference {
  if (!isRecord(value) || !validUuid(value.transactionId) || !validUuid(value.customerId) || !validUuid(value.quoteId) || !validUuid(value.externalRef) || typeof value.status !== "string" || !(value.txnHash === null || (typeof value.txnHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.txnHash)))) throw new RipioProviderError("invalid-response");
  const operationType = requiredAlias(value, ["operationType", "operation"]);
  const fromCurrency = requiredAlias(value, ["fromCurrency", "sourceCurrency"]);
  const toCurrency = requiredAlias(value, ["toCurrency", "destinationCurrency"]);
  const chain = requiredAlias(value, ["chain", "network"]);
  const destination = requiredAlias(value, ["destination", "depositAddress", "destinationAddress"]);
  const paymentMethodType = requiredAlias(value, ["paymentMethodType", "paymentMethod"]);
  const finalToAmount = requiredAlias(value, ["finalToAmount", "destinationAmount", "toAmount"]);
  if (operationType !== "ON_RAMP" || !validAddress(destination) || !validDecimal(finalToAmount)) throw new RipioProviderError("invalid-response");
  return {
    transactionId: value.transactionId,
    customerId: value.customerId,
    quoteId: value.quoteId,
    externalRef: value.externalRef,
    status: value.status,
    txnHash: value.txnHash,
    operationType,
    fromCurrency,
    toCurrency,
    chain,
    destination,
    paymentMethodType,
    finalToAmount,
    latestRefund: parseLatestRefund(value.latestRefund),
  };
}

function assertTransactionBinding(transaction: RipioTransactionReference, expected: ExpectedOrderBinding): void {
  if (
    transaction.customerId !== expected.customerId ||
    transaction.quoteId !== expected.quoteId ||
    transaction.externalRef !== expected.externalRef ||
    transaction.operationType !== "ON_RAMP" ||
    transaction.fromCurrency !== expected.fromCurrency ||
    transaction.toCurrency !== expected.toCurrency ||
    transaction.chain !== expected.chain ||
    transaction.destination.toLowerCase() !== expected.destination.toLowerCase() ||
    transaction.paymentMethodType !== expected.paymentMethodType ||
    !sameDecimal(transaction.finalToAmount, expected.finalToAmount)
  ) throw new RipioProviderError("invalid-response");
}

function parseInstructions(value: Record<string, unknown>, country: RipioEnabledCountry): RipioRailInstructions {
  if (country === "AR" && typeof value.cvu === "string" && /^\d{22}$/.test(value.cvu)) return { kind: "ar-bank-transfer", cvu: value.cvu, ...(typeof value.alias === "string" ? { alias: value.alias } : {}) };
  if (country === "CO" && typeof value.paymentUrl === "string" && safeHttps(value.paymentUrl)) return { kind: "co-payment-url", paymentUrl: value.paymentUrl };
  if (country === "CO" && typeof value.brebKey === "string" && value.brebKey.length > 0) return { kind: "co-breb", brebKey: value.brebKey };
  if (country === "CO" && typeof value.phoneNumber === "string" && value.phoneNumber.length > 0) return { kind: "co-r2p-nequi", phoneNumber: value.phoneNumber };
  throw new RipioProviderError("invalid-response");
}

async function parseCreateResponse<T>(request: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
  try {
    return parse(await request());
  } catch (error) {
    if (error instanceof RipioProviderError && error.code === "invalid-response") {
      throw new RipioProviderError("ambiguous-create", error.status, error);
    }
    throw error;
  }
}
function parseLatestRefund(value: unknown): RipioTransactionReference["latestRefund"] {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.status !== "string") throw new RipioProviderError("invalid-response");
  const rejectionReason = value.rejectionReason === null || value.rejectionReason === undefined
    ? null
    : typeof value.rejectionReason === "string" ? value.rejectionReason : null;
  return { status: value.status, rejectionReason };
}
function requiredAlias(value: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) if (typeof value[alias] === "string" && value[alias].length > 0) return value[alias];
  throw new RipioProviderError("invalid-response");
}
async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch (error) { throw new RipioProviderError("invalid-response", response.status, error); }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validAddress(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value); }
function validDecimal(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value); }
function sameDecimal(left: string, right: string): boolean {
  if (!validDecimal(left) || !validDecimal(right)) return false;
  const normalize = (value: string) => value.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
  return normalize(left) === normalize(right);
}
function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validEmail(value: string): boolean { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safeHttps(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }
function catalogEntitles(value: unknown, country: RipioEnabledCountry): boolean {
  const catalog = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.networks) ? value.networks : null;
  if (!catalog) return false;
  const expected = RIPIO_ASSETS[country];
  return catalog.some((network) =>
    isRecord(network) &&
    (network.network_name === "BASE" || network.networkName === "BASE") &&
    Array.isArray(network.assets) &&
    network.assets.some((asset) =>
      isRecord(asset) &&
      asset.name === expected.token &&
      typeof (asset.contract_address ?? asset.contractAddress) === "string" &&
      String(asset.contract_address ?? asset.contractAddress).toLowerCase() === expected.tokenAddress.toLowerCase(),
    ),
  );
}

export const RIPIO_PRODUCTION_ASSETS = RIPIO_ASSETS;
