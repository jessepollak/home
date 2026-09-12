import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  FundingProvider,
  Observation,
  ProviderContext,
  Quote,
  ReportedState,
} from "@/shared/funding/provider-contract";
import {
  createRipioClient,
  RipioProviderError,
  type RipioClient,
  type RipioOrderReference,
} from "../../ripio-client";
import { parseRipioWebhook } from "../../ripio-reconciliation";
import { ripioManifest } from "./manifest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ripioProvider: FundingProvider = {
  manifest: ripioManifest,

  async ensureCustomer(input, ctx) {
    const email = input.fields.email?.trim();
    if (!email) throw new RipioProviderError("invalid-request");
    const client = clientFor(ctx);
    const customer = await client.createCustomer({ email });
    const terms = await client.getTerms();
    const termsId = readTermsId(terms);
    if (termsId) await client.acceptTerms(customer.customerId, termsId);
    const kyc = Object.fromEntries(
      Object.entries(input.fields).filter(([name]) => name !== "email"),
    );
    if (Object.keys(kyc).length > 0) await client.submitKyc(customer.customerId, kyc);
    return { customerRef: customer.customerId };
  },

  async createQuote(input, ctx) {
    const quote = await clientFor(ctx).createQuote({
      country: countryFor(ctx),
      fromCurrency: ctx.binding.asset.fiatCurrency as "ARS" | "COP",
      toCurrency: ctx.binding.asset.symbol as "wARS" | "wCOP",
      fromAmount: input.fiatAmount,
      chain: "BASE",
      paymentMethodType: ctx.binding.paymentMethod.id as "bank_transfer" | "breb" | "r2p_bancolombia" | "r2p_nequi",
      destination: input.destination,
    });
    return {
      providerQuoteId: quote.quoteId,
      fiatAmount: quote.finalFromAmount,
      tokenAmountAtomic: decimalToAtomic(quote.finalToAmount, ctx.binding.asset.decimals),
      fees: quote.fees.map((fee) => ({
        label: fee.type,
        amount: fee.amount,
        currency: fee.currency,
      })),
      expiresAt: quote.expiration,
    };
  },

  async createOrder(input, ctx) {
    if (!input.quote?.providerQuoteId || !input.customerRef || !UUID.test(input.homeOrderId)) {
      return { outcome: "rejected", message: "A current quote and verified customer are required." };
    }
    try {
      const order = await clientFor(ctx).createOnramp({
        customerId: input.customerRef,
        quoteId: input.quote.providerQuoteId,
        externalRef: input.homeOrderId,
        destination: input.destination,
        fromCurrency: ctx.binding.asset.fiatCurrency,
        toCurrency: ctx.binding.asset.symbol,
        chain: "BASE",
        paymentMethodType: ctx.binding.paymentMethod.id,
        finalToAmount: atomicToDecimal(input.quote.tokenAmountAtomic, ctx.binding.asset.decimals),
      });
      return {
        outcome: "created",
        order: {
          providerOrderId: order.transactionId,
          tokenAddress: ctx.binding.asset.address,
          expectedTokenAmountAtomic: input.quote.tokenAmountAtomic,
          fees: input.quote.fees,
          expiresAt: input.quote.expiresAt,
          instructions: instructionsFor(order, input.quote, ctx),
        },
      };
    } catch (error) {
      if (error instanceof RipioProviderError && error.code === "ambiguous-create") {
        return { outcome: "ambiguous" };
      }
      if (error instanceof RipioProviderError && error.code === "invalid-request") {
        return { outcome: "rejected", message: "Ripio rejected this order." };
      }
      return { outcome: "ambiguous" };
    }
  },

  async getOrder(input, ctx) {
    const transaction = await clientFor(ctx).getTransaction(input.providerOrderId);
    if (
      transaction.destination && transaction.destination.toLowerCase() !== input.destination.toLowerCase()
      || transaction.operationType && transaction.operationType !== "ON_RAMP"
      || transaction.chain && transaction.chain !== "BASE"
      || transaction.fromCurrency && transaction.fromCurrency !== ctx.binding.asset.fiatCurrency
      || transaction.toCurrency && transaction.toCurrency !== ctx.binding.asset.symbol
      || transaction.paymentMethodType && transaction.paymentMethodType !== ctx.binding.paymentMethod.id
      || transaction.amount && decimalToAtomic(transaction.amount, input.tokenDecimals) !== input.expectedTokenAmountAtomic
    ) throw new RipioProviderError("binding-conflict");
    return observationFor(transaction.status, transaction.txnHash);
  },

  verifyWebhook(raw, headers, ctx) {
    const supplied = headers.get(ripioManifest.webhook.signatureHeader)?.trim().replace(/^sha256=/i, "");
    if (!supplied || !/^[0-9a-f]{64}$/i.test(supplied)) return null;
    const expected = createHmac("sha256", ctx.env.RIPIO_WEBHOOK_SECRET).update(raw).digest();
    const actual = Buffer.from(supplied, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const event = parseRipioWebhook(raw);
    return event ? { providerOrderId: event.providerOrderId } : null;
  },
};

function clientFor(ctx: ProviderContext): RipioClient {
  return createRipioClient(countryFor(ctx), {
    env: ctx.env,
    fetchImplementation: ctx.fetch,
  });
}

function countryFor(ctx: ProviderContext): "AR" | "CO" {
  if (ctx.binding.region !== "AR" && ctx.binding.region !== "CO") {
    throw new RipioProviderError("invalid-request");
  }
  return ctx.binding.region;
}

function instructionsFor(order: RipioOrderReference, quote: Quote, ctx: ProviderContext) {
  const amount = quote.fiatAmount;
  const currency = ctx.binding.asset.fiatCurrency;
  switch (order.instructions.kind) {
    case "ar-bank-transfer":
      return { kind: "bank-transfer" as const, rail: "CVU", accountNumber: order.instructions.cvu, alias: order.instructions.alias, amount, currency };
    case "co-payment-url":
      return { kind: "redirect" as const, url: order.instructions.paymentUrl };
    case "co-breb":
      return { kind: "payment-key" as const, scheme: "Bre-B", key: order.instructions.brebKey, amount, currency };
    case "co-r2p-nequi":
      return { kind: "payment-key" as const, scheme: "Nequi", key: order.instructions.phoneNumber, amount, currency };
  }
}

function observationFor(status: string, hash: string | null): Observation {
  const normalized = status.toUpperCase();
  let state: ReportedState;
  if (["CREATED", "PENDING", "AWAITING_PAYMENT"].includes(normalized)) state = "awaiting-payment";
  else if (["PAYMENT_RECEIVED", "ONRAMP_PAYMENT_RECEIVED"].includes(normalized)) state = "payment-received";
  else if (["CONVERTING", "PROCESSING", "SENDING", "ONRAMP_CRYPTO_BUY_IN_PROGRESS"].includes(normalized)) state = "settling";
  else if (["COMPLETED", "SUCCESS", "ONRAMP_CRYPTO_SENT"].includes(normalized)) state = "sent";
  else if (["CANCELLED", "ONRAMP_CANCELED"].includes(normalized)) state = "cancelled";
  else if (normalized === "EXPIRED") state = "expired";
  else if (["REFUNDED", "REFUND_COMPLETED", "ONRAMP_REFUNDED"].includes(normalized)) state = "refunded";
  else if (["FAILED", "SERVICE_UNAVAILABLE", "ONRAMP_FAILED"].includes(normalized)) state = "failed";
  else state = "unknown";
  return { state, providerStatus: status, transactionHash: hash as `0x${string}` | null };
}

function decimalToAtomic(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new RipioProviderError("invalid-response");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new RipioProviderError("invalid-response");
  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

function atomicToDecimal(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new RipioProviderError("invalid-request");
  const padded = value.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${padded.slice(0, -decimals)}.${fraction}` : padded.slice(0, -decimals);
}

function readTermsId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const direct = record.termsId ?? record.id;
  if (typeof direct === "string" && UUID.test(direct)) return direct;
  const entries = Array.isArray(record.results) ? record.results : Array.isArray(value) ? value : [];
  for (const entry of entries) {
    if (typeof entry === "object" && entry && typeof (entry as Record<string, unknown>).id === "string" && UUID.test((entry as Record<string, unknown>).id as string)) {
      return (entry as Record<string, unknown>).id as string;
    }
  }
  return null;
}
