import "server-only";

import { createHash } from "node:crypto";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type {
  CreateOrderResult,
  FundingProvider,
  Observation,
  OrderIntent,
  ProviderContext,
  ProviderOrder,
  Quote,
  QuoteIntent,
  ReconciliationIntent,
} from "@/shared/funding/provider-contract";
import { atomicToDecimal, decimalToAtomic } from "@/shared/formatting/atomic";
import { emitServerEvent } from "@/server/observability/log";
import {
  COINBASE_ONRAMP_API_ORIGIN,
  COINBASE_ONRAMP_REDIRECT_ORIGIN,
  coinbaseManifest,
} from "./manifest";

const ONRAMP_HOST = "api.cdp.coinbase.com";
const ORDERS_PATH = "/platform/v2/onramp/orders";
const ORDERS_URL = `${COINBASE_ONRAMP_API_ORIGIN}${ORDERS_PATH}`;
const PAYMENT_METHOD = "GUEST_CHECKOUT_APPLE_PAY";
// Standard-mode orders return an Apple Pay button link; embedded orders (Coinbase
// collects contact, OTP and identity in the hosted session) return an embedded-order
// link. Observed live on 2026-09-13; the API reference example shows only the first.
const PAYMENT_LINK_TYPES = [
  "PAYMENT_LINK_TYPE_APPLE_PAY_BUTTON",
  "PAYMENT_LINK_TYPE_EMBEDDED_ORDER",
] as const;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RESPONSE_BODY_TIMEOUT_MS = 6_000;
const MAX_STRING_LENGTH = 4096;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

type JwtGenerator = typeof generateJwt;
type JsonRecord = Record<string, unknown>;
type FailureCode =
  | "QUOTE_ECHO_MISMATCH"
  | "ORDER_ECHO_MISMATCH"
  | "ORDER_AMBIGUOUS"
  | "STATUS_ECHO_MISMATCH"
  | "PROVIDER_HTTP_4XX"
  | "PROVIDER_HTTP_5XX"
  | "PROVIDER_TRANSPORT";

type CoinbaseProviderOptions = {
  generateJwtImplementation?: JwtGenerator;
};

type CoinbaseFees = {
  fees: ProviderOrder["fees"];
  totalAtomic: bigint;
};

export function createCoinbaseProvider(
  options: CoinbaseProviderOptions = {},
): FundingProvider {
  const generateJwtImplementation = options.generateJwtImplementation ?? generateJwt;

  return {
    manifest: coinbaseManifest,

    async createQuote(input, ctx) {
      const startedAt = Date.now();
      const body = createQuoteBody(input, ctx);
      const response = await postOrders(
        body,
        ctx,
        generateJwtImplementation,
        startedAt,
        "quote",
      );
      if (response.status !== 201) {
        emitHttpFailure(response.status, startedAt);
        throw new Error("Coinbase quote request failed.");
      }
      let text: string;
      try {
        text = await readBoundedText(response);
      } catch (error) {
        emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
        throw error;
      }
      try {
        return quoteFromResponse(parseProviderJson(text), input);
      } catch (error) {
        emitFailure("QUOTE_ECHO_MISMATCH", startedAt, "failed");
        throw error;
      }
    },

    async createOrder(input, ctx) {
      const startedAt = Date.now();
      const body = createOrderBody(input, ctx);
      if (!body) {
        return {
          outcome: "rejected",
          message: "A current funding quote is required.",
        };
      }

      let token: string;
      try {
        token = await createJwt(ctx, "POST", ORDERS_PATH, generateJwtImplementation);
      } catch {
        emitFailure("PROVIDER_TRANSPORT", startedAt, "rejected");
        return {
          outcome: "rejected",
          message: "Coinbase could not authorize this funding order.",
        };
      }

      let response: Response;
      try {
        response = await ctx.fetch(ORDERS_URL, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(body),
          cache: "no-store",
        });
      } catch {
        emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
        return { outcome: "ambiguous" };
      }

      if (response.status !== 201) {
        return classifyCreateFailure(response, startedAt);
      }

      let payload: unknown;
      try {
        payload = parseProviderJson(await readBoundedText(response));
      } catch {
        emitFailure("ORDER_AMBIGUOUS", startedAt, "unavailable");
        return { outcome: "ambiguous" };
      }

      try {
        return {
          outcome: "created",
          order: orderFromResponse(payload, input, ctx),
        };
      } catch {
        emitFailure("ORDER_ECHO_MISMATCH", startedAt, "failed");
        return { outcome: "ambiguous" };
      }
    },

    async getOrder(input, ctx) {
      const startedAt = Date.now();
      const providerOrderId = readProviderOrderId(input.providerOrderId);
      if (!providerOrderId || !validReconciliationIntent(input, ctx)) {
        emitFailure("STATUS_ECHO_MISMATCH", startedAt, "failed");
        return unknown("INVALID_RECONCILIATION_INTENT");
      }
      const requestPath = `${ORDERS_PATH}/${encodeURIComponent(providerOrderId)}`;
      let token: string;
      try {
        token = await createJwt(ctx, "GET", requestPath, generateJwtImplementation);
      } catch {
        emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
        return unknown("AUTHORIZATION_ERROR");
      }

      let response: Response;
      try {
        response = await ctx.fetch(`${COINBASE_ONRAMP_API_ORIGIN}${requestPath}`, {
          method: "GET",
          headers: requestHeaders(token),
          cache: "no-store",
        });
      } catch {
        emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
        return unknown("TRANSPORT_ERROR");
      }
      if (!response.ok) {
        emitHttpFailure(response.status, startedAt);
        return unknown(`HTTP_${response.status}`);
      }

      try {
        const payload = parseProviderJson(await readBoundedText(response));
        return observationFromResponse(payload, input);
      } catch {
        emitFailure("STATUS_ECHO_MISMATCH", startedAt, "failed");
        return unknown("INVALID_RESPONSE");
      }
    },
  };
}

export const coinbaseProvider = createCoinbaseProvider();

function createQuoteBody(input: QuoteIntent, ctx: ProviderContext): Record<string, unknown> {
  return {
    isQuote: true,
    paymentMethod: PAYMENT_METHOD,
    paymentCurrency: "USD",
    paymentAmount: input.fiatAmount,
    purchaseCurrency: "USDC",
    destinationNetwork: "base",
    destinationAddress: input.destination,
    partnerUserRef: partnerUserRef(input.destination, ctx.sandbox),
    domain: domainFromReturnUrl(input.returnUrl),
  };
}

function createOrderBody(
  input: OrderIntent,
  ctx: ProviderContext,
): Record<string, unknown> | null {
  if (
    !input.quote ||
    input.quote.fiatAmount !== input.fiatAmount ||
    !/^(?:0|[1-9]\d*)$/.test(input.quote.tokenAmountAtomic)
  ) {
    return null;
  }
  let purchaseAmount: string;
  let domain: string;
  try {
    purchaseAmount = atomicToDecimal(
      input.quote.tokenAmountAtomic,
      ctx.binding.asset.decimals,
    );
    domain = domainFromReturnUrl(input.returnUrl);
  } catch {
    return null;
  }
  return {
    paymentMethod: PAYMENT_METHOD,
    paymentCurrency: "USD",
    purchaseAmount,
    purchaseCurrency: "USDC",
    destinationNetwork: "base",
    destinationAddress: input.destination,
    partnerUserRef: partnerUserRef(input.destination, ctx.sandbox),
    partnerOrderRef: input.homeOrderId,
    ...(input.clientIp ? { clientIp: input.clientIp } : {}),
    domain,
  };
}

async function postOrders(
  body: Record<string, unknown>,
  ctx: ProviderContext,
  generateJwtImplementation: JwtGenerator,
  startedAt: number,
  operation: "quote",
): Promise<Response> {
  let token: string;
  try {
    token = await createJwt(ctx, "POST", ORDERS_PATH, generateJwtImplementation);
  } catch (error) {
    emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
    throw error;
  }
  try {
    return await ctx.fetch(ORDERS_URL, {
      method: "POST",
      headers: requestHeaders(token),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    emitFailure("PROVIDER_TRANSPORT", startedAt, "unavailable");
    throw new Error(`Coinbase ${operation} request failed.`, { cause: error });
  }
}

async function createJwt(
  ctx: ProviderContext,
  method: "GET" | "POST",
  requestPath: string,
  generateJwtImplementation: JwtGenerator,
): Promise<string> {
  return await generateJwtImplementation({
    apiKeyId: ctx.env.CDP_API_KEY_ID,
    apiKeySecret: ctx.env.CDP_API_KEY_SECRET,
    requestMethod: method,
    requestHost: ONRAMP_HOST,
    requestPath,
    expiresIn: 120,
  });
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function quoteFromResponse(value: unknown, input: QuoteIntent): Quote {
  const order = readOrder(value);
  assertExact(order.paymentCurrency, "USD");
  assertExact(order.purchaseCurrency, "USDC");
  assertExact(order.destinationNetwork, "base");
  assertAddress(order.destinationAddress, input.destination);
  const paymentTotal = readDecimal(order.paymentTotal, 2);
  if (decimalToAtomic(paymentTotal, 2) !== decimalToAtomic(input.fiatAmount, 2)) {
    throw new Error("Coinbase quote total mismatch.");
  }
  const fees = readFees(order.fees);
  assertPaymentEquation(paymentTotal, order.paymentSubtotal, fees.totalAtomic);
  const purchaseAmount = readDecimal(order.purchaseAmount, 6);
  return {
    fiatAmount: input.fiatAmount,
    tokenAmountAtomic: decimalToAtomic(purchaseAmount, 6),
    fees: fees.fees,
    feesKnown: true,
    expiresAt: new Date(Date.now() + 3 * 60_000).toISOString(),
  };
}

function orderFromResponse(
  value: unknown,
  input: OrderIntent,
  ctx: ProviderContext,
): ProviderOrder {
  if (!input.quote) throw new Error("Missing Coinbase quote.");
  const envelope = readRecord(value);
  const order = readRecord(envelope.order);
  const providerOrderId = readProviderOrderId(order.orderId);
  if (!providerOrderId) throw new Error("Invalid Coinbase order ID.");
  assertExact(order.paymentMethod, PAYMENT_METHOD);
  assertExact(order.paymentCurrency, "USD");
  assertExact(order.purchaseCurrency, "USDC");
  assertExact(order.destinationNetwork, "base");
  assertAddress(order.destinationAddress, input.destination);
  assertExact(order.partnerUserRef, partnerUserRef(input.destination, ctx.sandbox));
  const purchaseAmount = readDecimal(order.purchaseAmount, 6);
  const purchaseAmountAtomic = decimalToAtomic(purchaseAmount, 6);
  if (purchaseAmountAtomic !== input.quote.tokenAmountAtomic) {
    throw new Error("Coinbase purchase amount mismatch.");
  }
  const paymentTotal = readDecimal(order.paymentTotal, 2);
  const fees = readFees(order.fees);
  assertPaymentEquation(paymentTotal, order.paymentSubtotal, fees.totalAtomic);
  const paymentLink = readRecord(envelope.paymentLink);
  if (!(PAYMENT_LINK_TYPES as readonly unknown[]).includes(paymentLink.paymentLinkType)) {
    throw new Error("Coinbase echo mismatch.");
  }
  const paymentUrl = paymentUrlForMode(readPaymentUrl(paymentLink.url), ctx.sandbox);
  return {
    providerOrderId,
    tokenAddress: ctx.binding.asset.address,
    expectedTokenAmountAtomic: purchaseAmountAtomic,
    fees: fees.fees,
    expiresAt: null,
    instructions: {
      kind: "embed",
      url: paymentUrl,
      presentation: "apple-pay",
      amount: paymentTotal,
      currency: "USD",
    },
  };
}

function observationFromResponse(
  value: unknown,
  input: ReconciliationIntent,
): Observation {
  const order = readOrder(value);
  assertExact(order.orderId, input.providerOrderId);
  assertAddress(order.destinationAddress, input.destination);
  assertExact(order.destinationNetwork, "base");
  assertExact(order.purchaseCurrency, "USDC");
  const purchaseAmount = readDecimal(order.purchaseAmount, 6);
  if (decimalToAtomic(purchaseAmount, 6) !== input.expectedTokenAmountAtomic) {
    throw new Error("Coinbase status amount mismatch.");
  }
  const providerStatus = readBoundedString(order.status, 128);
  const state = stateFromStatus(providerStatus);
  const txHash = typeof order.txHash === "string" && transactionHashPattern.test(order.txHash)
    ? order.txHash.toLowerCase() as `0x${string}`
    : null;
  return {
    state,
    providerStatus,
    ...(txHash ? { transactionHash: txHash } : {}),
  };
}

async function classifyCreateFailure(
  response: Response,
  startedAt: number,
): Promise<CreateOrderResult> {
  emitHttpFailure(response.status, startedAt);
  if (response.status !== 400) return { outcome: "ambiguous" };
  try {
    const payload = parseProviderJson(await readBoundedText(response));
    if (
      !isRecord(payload) ||
      (typeof payload.errorType !== "string" &&
        typeof payload.errorMessage !== "string")
    ) return { outcome: "ambiguous" };
    return {
      outcome: "rejected",
      message: "Coinbase rejected the funding order.",
    };
  } catch {
    emitFailure("ORDER_AMBIGUOUS", startedAt, "unavailable");
    return { outcome: "ambiguous" };
  }
}

function stateFromStatus(status: string): Observation["state"] {
  if (
    status === "ONRAMP_ORDER_STATUS_PENDING_VERIFICATION" ||
    status === "ONRAMP_ORDER_STATUS_PENDING_PAYMENT"
  ) return "awaiting-payment";
  if (status === "ONRAMP_ORDER_STATUS_PROCESSING") return "settling";
  if (status === "ONRAMP_ORDER_STATUS_COMPLETED") return "sent";
  if (status === "ONRAMP_ORDER_STATUS_FAILED") return "failed";
  if (status === "ONRAMP_ORDER_STATUS_CANCELLED") return "cancelled";
  if (status === "ONRAMP_ORDER_STATUS_EXPIRED") return "expired";
  return "unknown";
}

function readOrder(value: unknown): JsonRecord {
  return readRecord(readRecord(value).order);
}

function readFees(value: unknown): CoinbaseFees {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Invalid Coinbase fees.");
  }
  let totalAtomic = BigInt(0);
  const fees = value.map((candidate) => {
    const fee = readRecord(candidate);
    assertExact(fee.currency, "USD");
    const type = readBoundedString(fee.type, 128);
    const amount = readDecimal(fee.amount, 2);
    totalAtomic += BigInt(decimalToAtomic(amount, 2));
    return { label: feeLabel(type), amount, currency: "USD" };
  });
  return { fees, totalAtomic };
}

function feeLabel(type: string): string {
  if (type === "FEE_TYPE_EXCHANGE") return "Coinbase fee";
  if (type === "FEE_TYPE_NETWORK") return "Network fee";
  return type;
}

function assertPaymentEquation(
  paymentTotal: string,
  paymentSubtotal: unknown,
  feeTotalAtomic: bigint,
): void {
  const totalAtomic = BigInt(decimalToAtomic(paymentTotal, 2));
  const subtotalAtomic = BigInt(decimalToAtomic(readDecimal(paymentSubtotal, 2), 2));
  if (totalAtomic !== subtotalAtomic + feeTotalAtomic) {
    throw new Error("Coinbase payment total mismatch.");
  }
}

function readPaymentUrl(value: unknown): string {
  const raw = readBoundedString(value, MAX_STRING_LENGTH);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.origin !== COINBASE_ONRAMP_REDIRECT_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Invalid Coinbase payment URL.");
  }
  return url.toString();
}

function validReconciliationIntent(
  input: ReconciliationIntent,
  ctx: ProviderContext,
): boolean {
  return (
    input.transactionType === "MINT" &&
    input.chainId === ctx.binding.asset.chainId &&
    input.tokenAddress.toLowerCase() === ctx.binding.asset.address.toLowerCase() &&
    input.tokenDecimals === ctx.binding.asset.decimals &&
    /^0x[0-9a-fA-F]{40}$/.test(input.destination) &&
    /^(?:0|[1-9]\d*)$/.test(input.expectedTokenAmountAtomic)
  );
}

function readProviderOrderId(value: unknown): string | null {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/.test(value)
    ? value
    : null;
}

function partnerUserRef(destination: `0x${string}`, sandbox: boolean): string {
  const reference = createHash("sha256")
    .update(`home:${destination.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return sandbox ? `sandbox-${reference}` : reference;
}

function paymentUrlForMode(value: string, sandbox: boolean): string {
  if (!sandbox) return value;
  const url = new URL(value);
  url.searchParams.set("useApplePaySandbox", "true");
  return url.toString();
}

function domainFromReturnUrl(returnUrl: string): string {
  const hostname = new URL(returnUrl).hostname;
  if (!hostname) throw new Error("Invalid Coinbase return URL.");
  return hostname;
}

function readDecimal(value: unknown, decimals: number): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new Error("Invalid Coinbase decimal.");
  }
  decimalToAtomic(value, decimals);
  return value;
}

function assertExact(value: unknown, expected: string): void {
  if (value !== expected) throw new Error("Coinbase echo mismatch.");
}

function assertAddress(value: unknown, expected: `0x${string}`): void {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    value.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error("Coinbase address echo mismatch.");
  }
}

function readBoundedString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error("Invalid Coinbase string.");
  }
  return value;
}

function readRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error("Invalid Coinbase response.");
  return value;
}

function unknown(providerStatus: string): Observation {
  return { state: "unknown", providerStatus };
}

function emitHttpFailure(status: number, startedAt: number): void {
  emitFailure(
    status >= 500 ? "PROVIDER_HTTP_5XX" : "PROVIDER_HTTP_4XX",
    startedAt,
    "unavailable",
  );
}

function emitFailure(
  code: FailureCode,
  startedAt: number,
  outcome: "failed" | "rejected" | "unavailable",
): void {
  emitServerEvent("funding-order", {
    route: "/funding/providers/coinbase",
    code,
    outcome,
    provider: "coinbase",
    durationMs: Date.now() - startedAt,
  });
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    BigInt(declaredLength) > BigInt(MAX_RESPONSE_BYTES)
  ) {
    throw new Error("Coinbase response is too large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let deadlineCleanup: () => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    const timeout = setTimeout(() => {
      void reader.cancel("Coinbase response body timed out.");
      reject(new Error("Coinbase response body timed out."));
    }, RESPONSE_BODY_TIMEOUT_MS);
    deadlineCleanup = () => clearTimeout(timeout);
  });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel("Coinbase response is too large.");
        throw new Error("Coinbase response is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    deadlineCleanup();
    reader.releaseLock();
  }
}

function parseProviderJson(text: string): unknown {
  return JSON.parse(text);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
