import "server-only";

import { fundingAssets } from "@/shared/funding/assets";

const RIPIO_PRODUCTION_ORIGIN = "https://skala.ripio.com";
const RIPIO_BASE_CHAIN = "BASE" as const;
type RipioCountry = "AR" | "BR" | "CO";
type RipioEnabledCountry = keyof typeof RIPIO_ASSETS;
type RipioPaymentMethod = "bank_transfer" | "breb" | "r2p_bancolombia" | "r2p_nequi";
type RipioQuoteRequest = {
  country: RipioEnabledCountry;
  fromCurrency: "ARS" | "COP";
  toCurrency: "wARS" | "wCOP";
  fromAmount: string;
  chain: typeof RIPIO_BASE_CHAIN;
  paymentMethodType: RipioPaymentMethod;
  destination: `0x${string}`;
};
type RipioQuote = {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  finalFromAmount: string;
  toAmount: string;
  finalToAmount: string;
  rate: string;
  expiration: string;
  fees: Array<{ amount: string; type: string; currency: string; appliesOnFromAmount: boolean; appliesOnToAmount: boolean }>;
};
type RipioRailInstructions =
  | { kind: "ar-bank-transfer"; cvu: string; alias?: string }
  | { kind: "co-payment-url"; paymentUrl: string }
  | { kind: "co-breb"; brebKey: string }
  | { kind: "co-r2p-nequi"; phoneNumber: string };

const RIPIO_ASSETS = {
  AR: {
    fiatCurrency: "ARS",
    token: "wARS",
    tokenAddress: fundingAssets["base:wars"].address,
    paymentMethods: ["bank_transfer"] as const,
  },
  CO: {
    fiatCurrency: "COP",
    token: "wCOP",
    tokenAddress: fundingAssets["base:wcop"].address,
    paymentMethods: ["bank_transfer", "breb", "r2p_bancolombia", "r2p_nequi"] as const,
  },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESPONSE_HEADER_BYTES = 16 * 1024;
const RESPONSE_BODY_TIMEOUT_MS = 6_000;

type Environment = Record<string, string | undefined>;
type RipioFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RipioProviderError extends Error {
  readonly code:
    | "not-configured"
    | "invalid-request"
    | "unauthorized"
    | "unavailable"
    | "invalid-response"
    | "binding-conflict"
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
  status: string;
  txnHash: string | null;
  customerId?: string;
  quoteId?: string;
  externalRef?: string;
  operationType?: "ON_RAMP";
  fromCurrency?: string;
  toCurrency?: string;
  chain?: string;
  destination?: `0x${string}`;
  paymentMethodType?: string;
  amount?: string;
  latestRefund: { status: string; rejectionReason: string | null } | null;
};

export type RipioOrderReference = RipioTransactionReference & {
  instructions: RipioRailInstructions;
};

export type RipioTransactionBinding = {
  customerId: string;
  quoteId: string;
  externalRef: string;
  destination: `0x${string}`;
  fromCurrency: string;
  toCurrency: string;
  chain: "BASE";
  paymentMethodType: string;
  finalToAmount: string;
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
  getTransaction(transactionId: string, expected?: RipioTransactionBinding): Promise<RipioTransactionReference>;
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
    if (clientId.length > 512 || clientSecret.length > 512) throw new RipioProviderError("invalid-request");
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
      value.access_token.length > 4096 ||
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
      // Only Ripio's documented 400 validation rejection proves no order was
      // accepted. Redirects, conflicts, rate limits, undocumented 422s, and
      // server failures may follow a committed create and are ambiguous.
      const uncertainCreate = create && response.status !== 400;
      throw new RipioProviderError(
        uncertainCreate ? "ambiguous-create" : response.status < 500 ? "invalid-request" : "unavailable",
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
    async getTransaction(transactionId, expected) {
      if (!validUuid(transactionId)) throw new RipioProviderError("invalid-request");
      const transaction = parseTransaction(await request(`/api/v1/transactions/${encodeURIComponent(transactionId)}/`), transactionId);
      if (expected) assertTransactionBinding(transaction, expected);
      return transaction;
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

type ExpectedOrderBinding = RipioTransactionBinding;

function parseOrder(value: unknown, country: RipioEnabledCountry, expected: ExpectedOrderBinding): RipioOrderReference {
  if (!isRecord(value) || !isRecord(value.transaction) || !isRecord(value.fiatPaymentInstructions)) throw new RipioProviderError("invalid-response");
  const transaction = parseTransaction(value.transaction);
  assertTransactionBinding(transaction, expected);
  return { ...transaction, instructions: parseInstructions(value.fiatPaymentInstructions, country) };
}

function parseTransaction(value: unknown, expectedTransactionId?: string): RipioTransactionReference {
  if (!isRecord(value) || !validUuid(value.transactionId) || (expectedTransactionId && value.transactionId !== expectedTransactionId) || typeof value.status !== "string" || value.status.length === 0 || value.status.length > 128) {
    throw new RipioProviderError("invalid-response");
  }
  const customerId = optionalUuid(value, "customerId");
  const quoteId = optionalUuid(value, "quoteId");
  const externalRef = optionalUuid(value, "externalRef");
  const source = optionalString(value, "source");
  const fromCurrency = optionalString(value, "fromCurrency");
  const toCurrency = optionalString(value, "toCurrency");
  const chain = optionalString(value, "chain");
  const paymentMethodType = optionalString(value, "paymentMethodType");
  const depositAddress = optionalString(value, "depositAddress");
  const amount = optionalString(value, "amount");
  if (source !== undefined && source !== "ON_RAMP") throw new RipioProviderError("invalid-response");
  if (depositAddress !== undefined && !validAddress(depositAddress)) throw new RipioProviderError("invalid-response");
  if (amount !== undefined && !validDecimal(amount)) throw new RipioProviderError("invalid-response");
  const txnHash = value.txnHash === undefined || value.txnHash === null
    ? null
    : typeof value.txnHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.txnHash)
      ? value.txnHash
      : invalidTransactionField();
  return {
    transactionId: value.transactionId,
    status: value.status,
    txnHash,
    ...(customerId ? { customerId } : {}),
    ...(quoteId ? { quoteId } : {}),
    ...(externalRef ? { externalRef } : {}),
    ...(source ? { operationType: source } : {}),
    ...(fromCurrency ? { fromCurrency } : {}),
    ...(toCurrency ? { toCurrency } : {}),
    ...(chain ? { chain } : {}),
    ...(depositAddress ? { destination: depositAddress } : {}),
    ...(paymentMethodType ? { paymentMethodType } : {}),
    ...(amount ? { amount } : {}),
    latestRefund: parseLatestRefund(value.latestRefund),
  };
}

function assertTransactionBinding(transaction: RipioTransactionReference, expected: ExpectedOrderBinding): void {
  if (
    conflicts(transaction.customerId, expected.customerId) ||
    conflicts(transaction.quoteId, expected.quoteId) ||
    conflicts(transaction.externalRef, expected.externalRef) ||
    conflicts(transaction.operationType, "ON_RAMP") ||
    conflicts(transaction.fromCurrency, expected.fromCurrency) ||
    conflicts(transaction.toCurrency, expected.toCurrency) ||
    conflicts(transaction.chain, expected.chain) ||
    (transaction.destination !== undefined && transaction.destination.toLowerCase() !== expected.destination.toLowerCase()) ||
    conflicts(transaction.paymentMethodType, expected.paymentMethodType) ||
    (transaction.amount !== undefined && !sameDecimal(transaction.amount, expected.finalToAmount))
  ) throw new RipioProviderError("binding-conflict");
}

function parseInstructions(value: Record<string, unknown>, country: RipioEnabledCountry): RipioRailInstructions {
  if (country === "AR" && typeof value.cvu === "string" && /^\d{22}$/.test(value.cvu)) return { kind: "ar-bank-transfer", cvu: value.cvu, ...(typeof value.alias === "string" && value.alias.length <= 128 ? { alias: value.alias } : {}) };
  if (country === "CO" && typeof value.paymentUrl === "string" && value.paymentUrl.length <= 4096 && safeHttps(value.paymentUrl)) return { kind: "co-payment-url", paymentUrl: value.paymentUrl };
  if (country === "CO" && typeof value.brebKey === "string" && value.brebKey.length > 0 && value.brebKey.length <= 256) return { kind: "co-breb", brebKey: value.brebKey };
  if (country === "CO" && typeof value.phoneNumber === "string" && value.phoneNumber.length > 0 && value.phoneNumber.length <= 64) return { kind: "co-r2p-nequi", phoneNumber: value.phoneNumber };
  throw new RipioProviderError("invalid-response");
}

async function parseCreateResponse<T>(request: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
  try {
    return parse(await request());
  } catch (error) {
    if (error instanceof RipioProviderError && (error.code === "invalid-response" || error.code === "binding-conflict")) {
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
function optionalString(value: Record<string, unknown>, field: string): string | undefined {
  if (!(field in value)) return undefined;
  if (typeof value[field] !== "string" || value[field].length === 0 || value[field].length > 4096) throw new RipioProviderError("invalid-response");
  return value[field];
}
function optionalUuid(value: Record<string, unknown>, field: string): string | undefined {
  const candidate = optionalString(value, field);
  if (candidate === undefined) return undefined;
  if (!validUuid(candidate)) throw new RipioProviderError("invalid-response");
  return candidate;
}
function invalidTransactionField(): never { throw new RipioProviderError("invalid-response"); }
function conflicts(actual: string | undefined, expected: string): boolean { return actual !== undefined && actual !== expected; }
async function readJson(response: Response): Promise<unknown> {
  assertBoundedHeaders(response);
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new RipioProviderError("invalid-response", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new RipioProviderError("invalid-response", response.status);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RipioProviderError("invalid-response", response.status)), RESPONSE_BODY_TIMEOUT_MS);
    });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new RipioProviderError("invalid-response", response.status);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof RipioProviderError) throw error;
    throw new RipioProviderError("invalid-response", response.status, error);
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}
function assertBoundedHeaders(response: Response): void {
  let size = 0;
  response.headers.forEach((value, name) => { size += Buffer.byteLength(name) + Buffer.byteLength(value); });
  if (size > MAX_RESPONSE_HEADER_BYTES) throw new RipioProviderError("invalid-response", response.status);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validAddress(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value); }
function validDecimal(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value); }
function exactRipioEntitlement(input: RipioQuoteRequest): boolean {
  const asset = RIPIO_ASSETS[input.country];
  return input.fromCurrency === asset.fiatCurrency
    && input.toCurrency === asset.token
    && input.chain === RIPIO_BASE_CHAIN
    && /^0x[0-9a-fA-F]{40}$/.test(input.destination)
    && asset.paymentMethods.includes(input.paymentMethodType as never)
    && validDecimal(input.fromAmount)
    && /[1-9]/.test(input.fromAmount);
}
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
