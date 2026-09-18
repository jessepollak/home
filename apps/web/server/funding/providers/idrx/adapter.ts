import "server-only";

import { createHmac } from "node:crypto";
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
import { decimalToAtomic } from "@/shared/formatting/atomic";
import { IDRX_API_ORIGIN, IDRX_BANKS, IDRX_CHECKOUT_ORIGIN, idrxManifest } from "./manifest";

const MINT_PATH = "/transaction/mint-request";
const ONBOARDING_PATH = "/auth/onboarding";
const BANK_ACCOUNT_PATH = "/auth/add-bank-account";
const QUOTE_PATH = "/v2/transaction/mint-quote";
const HISTORY_PATH = "/transaction/user-transaction-history";
// The generic QRIS channel the IDRX checkout itself uses.
const QRIS_CHANNEL = "QR";
// IDRX quotes carry no expiry of their own: the fee schedule is per method and
// per organization, not per request. Five minutes matches the local quote.
const QUOTE_TTL_MS = 5 * 60_000;
const HISTORY_TAKE = 10;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RESPONSE_BODY_TIMEOUT_MS = 6_000;
const MIN_IDRX_ATOMIC = BigInt(2_000_000);
const MAX_IDRX_ATOMIC = BigInt("100000000000");
const MAX_IDRX_DECIMAL_LENGTH = "1000000000.00".length;
const orderIdPattern = /^[\x21-\x7e]{1,128}$/;
const accountNumberPattern = /^[0-9]{8,32}$/;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

type JsonRecord = Record<string, unknown>;

export const idrxProvider: FundingProvider = {
  manifest: idrxManifest,
  onramp: {
    // A Home user becomes a member of the operator's IDRX organization, so
    // orders are theirs: the closed VA is paid from the bank account
    // registered here, and the QRIS payer-name match uses their KTP name.
    // The member id is the customer reference the core stores.
    async ensureCustomer(input, ctx) {
      const fields = readKycFields(input.fields);
      const onboarded = await postJson(ctx, ONBOARDING_PATH, {
        email: fields.email,
        fullname: fields.fullname,
        address: fields.address,
        idNumber: fields.idNumber,
      });
      const memberId = readMemberId(onboarded.id);
      await postJson(ctx, BANK_ACCOUNT_PATH, {
        memberId,
        bankAccountNumber: fields.bankAccountNumber,
        bankName: fields.bank,
        bankCode: fields.bankCode,
      });
      return { customerRef: String(memberId) };
    },

    async createQuote(input, ctx) {
      const channel = quoteChannel(ctx);
      if (!channel) throw new Error("The selected IDRX payment method is not supported.");
      const url = new URL(QUOTE_PATH, IDRX_API_ORIGIN);
      url.searchParams.set("amount", input.fiatAmount);
      url.searchParams.set("chainId", String(ctx.binding.asset.chainId));
      url.searchParams.set("paymentMethod", channel.paymentMethod);
      url.searchParams.set("channelId", channel.channelId);
      const serializedUrl = url.toString();
      const response = await ctx.fetch(serializedUrl, {
        method: "GET",
        headers: createRequestHeaders(ctx, "GET", serializedUrl, ""),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`IDRX quote failed with HTTP ${response.status}.`);
      const data = readData(parseProviderJson(await readBoundedText(response)));
      return readQuote(data, input, ctx, channel);
    },

    async createOrder(input, ctx) {
    const atomic = input.fiatAmount.length <= MAX_IDRX_DECIMAL_LENGTH
      ? idrxAtomicAmount(input.fiatAmount, ctx.binding.asset.decimals)
      : null;
    if (
      atomic === null ||
      atomic < MIN_IDRX_ATOMIC ||
      atomic > MAX_IDRX_ATOMIC
    ) {
      return {
        outcome: "rejected",
        message: "The amount is outside the supported IDRX range.",
      };
    }

    if (input.customerRef !== undefined && !/^[1-9][0-9]{0,11}$/.test(input.customerRef)) {
      // A reference Home stored that is not an IDRX member id: nothing was
      // sent, so this is a rejection, not an ambiguous dispatch.
      return { outcome: "rejected", message: "The IDRX customer reference is invalid." };
    }
    const body = createMintBody(input, ctx);
    if (!body) {
      return {
        outcome: "rejected",
        message: "The selected IDRX payment method is not supported.",
      };
    }

    const url = `${IDRX_API_ORIGIN}${MINT_PATH}`;
    const serializedBody = JSON.stringify(body);
    let response: Response;
    try {
      response = await ctx.fetch(url, {
        method: "POST",
        headers: createRequestHeaders(ctx, "POST", url, serializedBody),
        body: serializedBody,
        cache: "no-store",
      });
    } catch {
      return { outcome: "ambiguous" };
    }

    if (!response.ok) return classifyCreateFailure(response);

    try {
      const payload = parseProviderJson(await readBoundedText(response));
      const data = readData(payload);
      const providerOrderId = readOrderId(data.merchantOrderId);
      const channel = channelForPaymentMethod(ctx.binding.paymentMethod.id);
      const paymentEchoes = assertCreateEchoes(
        data,
        input,
        ctx,
        providerOrderId,
        atomic,
        channel,
      );
      const checkoutUrl = readCheckoutUrlEchoes(
        data,
        ctx.binding.paymentMethod.id === "qris",
      );
      // With a quote the expected amount is the quoted net mint, which the
      // core checks the created order against; the create echoes above are
      // still checked against the requested amount, because IDRX deducts the
      // QRIS fee only when the payment lands.
      const common = {
        providerOrderId,
        tokenAddress: ctx.binding.asset.address,
        expectedTokenAmountAtomic: input.quote
          ? input.quote.tokenAmountAtomic
          : atomic.toString(10),
      } as const;

      if (ctx.binding.paymentMethod.id === "qris") {
        if (!checkoutUrl) throw new Error("Missing IDRX checkout URL.");
        return created({
          ...common,
          // The hosted session carries no fee lines; the quote already
          // itemized them for this method.
          fees: paymentEchoes?.fees ?? input.quote?.fees ?? [],
          expiresAt: null,
          instructions: {
            kind: "redirect",
            url: checkoutUrl,
          },
        });
      }

      if (!channel || !paymentEchoes) throw new Error("Invalid IDRX channel payload.");
      const { fees, paymentAmount } = paymentEchoes;
      const accountName = readBoundedString(data.virtualAccountName, 128);
      const accountNumber = readBoundedString(data.virtualAccountNo, 32);
      if (!accountNumberPattern.test(accountNumber)) {
        throw new Error("Invalid IDRX virtual account.");
      }
      // The VA is named after the member the order was created for. Home
      // keeps no copy of that name, so the echo is bounded but not compared.
      return created({
        ...common,
        fees,
        expiresAt: readExpiry(data.expiredDate),
        instructions: {
          kind: "bank-transfer",
          rail: "virtual-account",
          accountNumber,
          accountName: accountName.trim(),
          bank: channel,
          ...readOptionalReference(data.reference),
          amount: paymentAmount,
          currency: "IDR",
        },
      });
    } catch {
      return { outcome: "ambiguous" };
    }
  },

  async getOrder(input, ctx) {
    if (!isValidReconciliationIntent(input, ctx)) {
      return unknown("INVALID_RECONCILIATION_INTENT");
    }
    const providerOrderId = input.providerOrderId;
    const url = new URL(HISTORY_PATH, IDRX_API_ORIGIN);
    url.searchParams.set("transactionType", input.transactionType);
    url.searchParams.set("page", "1");
    url.searchParams.set("take", String(HISTORY_TAKE));
    url.searchParams.set("merchantOrderId", providerOrderId);
    const serializedUrl = url.toString();

    let response: Response;
    try {
      response = await ctx.fetch(serializedUrl, {
        method: "GET",
        headers: createRequestHeaders(ctx, "GET", serializedUrl, ""),
        cache: "no-store",
      });
    } catch {
      return unknown("TRANSPORT_ERROR");
    }
    if (!response.ok) return unknown(`HTTP_${response.status}`);

    try {
      const payload = parseProviderJson(await readBoundedText(response));
      if (!isRecord(payload) || !Array.isArray(payload.records)) {
        return unknown("INVALID_RESPONSE");
      }
      if (payload.records.length > HISTORY_TAKE) return unknown("INVALID_RESPONSE");
      if (payload.records.length === 0) {
        return { state: "awaiting-payment", providerStatus: "NOT_FOUND" };
      }
      if (payload.records.length !== 1 || !isRecord(payload.records[0])) {
        return unknown("AMBIGUOUS_HISTORY");
      }
      const record = payload.records[0];
      const settlement = readReconciliationSettlement(record, input, ctx);
      if (!settlement) return unknown("INTENT_MISMATCH");
      return observationFromRecord(record, settlement);
    } catch {
      return unknown("INVALID_RESPONSE");
    }
    },
  },
};

function createMintBody(
  input: OrderIntent,
  ctx: ProviderContext,
): Record<string, unknown> | null {
  const common = {
    toBeMinted: input.fiatAmount,
    destinationWalletAddress: input.destination,
    networkChainId: String(ctx.binding.asset.chainId),
    requestType: "idrx",
    expiryPeriod: 60,
    // The order belongs to the Home user's IDRX member, not the operator.
    ...(input.customerRef ? { memberId: readMemberId(input.customerRef) } : {}),
  };
  const channel = channelForPaymentMethod(ctx.binding.paymentMethod.id);
  if (channel) {
    return {
      ...common,
      paymentMethod: "va",
      channelId: channel,
    };
  }
  if (ctx.binding.paymentMethod.id === "qris") {
    // `flow: "hosted"` keeps the IDRX checkout page but opens it directly on
    // QRIS, so the user pays with the method this order was quoted for and
    // cannot switch to a Virtual Account (different fees) on that page.
    return {
      ...common,
      returnUrl: input.returnUrl,
      paymentMethod: "qris",
      channelId: QRIS_CHANNEL,
      flow: "hosted",
    };
  }
  return null;
}

type IdrxKycFields = {
  email: string;
  fullname: string;
  address: string;
  idNumber: string;
  bank: keyof typeof IDRX_BANKS;
  bankCode: string;
  bankAccountNumber: string;
};

function readKycFields(fields: Record<string, string>): IdrxKycFields {
  const text = (name: string, max: number) => {
    const value = (fields[name] ?? "").trim();
    if (value.length === 0 || value.length > max) throw new Error(`Invalid IDRX KYC field: ${name}.`);
    return value;
  };
  const email = text("email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid IDRX KYC field: email.");
  const idNumber = text("idNumber", 16);
  if (!/^[0-9]{16}$/.test(idNumber)) throw new Error("Invalid IDRX KYC field: idNumber.");
  const bank = text("bank", 16);
  if (!(bank in IDRX_BANKS)) throw new Error("Invalid IDRX KYC field: bank.");
  const bankAccountNumber = text("bankAccountNumber", 32);
  if (!accountNumberPattern.test(bankAccountNumber)) throw new Error("Invalid IDRX KYC field: bankAccountNumber.");
  return {
    email,
    fullname: text("fullname", 128),
    address: text("address", 255),
    idNumber,
    bank: bank as keyof typeof IDRX_BANKS,
    bankCode: IDRX_BANKS[bank as keyof typeof IDRX_BANKS].code,
    bankAccountNumber,
  };
}

function readMemberId(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]{0,11}$/.test(text)) throw new Error("Invalid IDRX member id.");
  return Number(text);
}

// A signed POST whose 2xx `data` is returned, and whose failure is an error
// with the status: `ensureCustomer` has no partial outcome worth keeping.
async function postJson(ctx: ProviderContext, path: string, body: Record<string, unknown>): Promise<JsonRecord> {
  const url = `${IDRX_API_ORIGIN}${path}`;
  const serializedBody = JSON.stringify(body);
  const response = await ctx.fetch(url, {
    method: "POST",
    headers: createRequestHeaders(ctx, "POST", url, serializedBody),
    body: serializedBody,
    cache: "no-store",
  });
  const text = await readBoundedText(response);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = parseProviderJson(text);
      if (isRecord(payload) && typeof payload.message === "string") message = readBoundedString(payload.message, 256);
    } catch {
      // The status is the message.
    }
    throw new Error(`IDRX ${path} failed: ${message}`);
  }
  return readData(parseProviderJson(text));
}

function quoteChannel(
  ctx: ProviderContext,
): { paymentMethod: "va" | "qris"; channelId: string } | null {
  const channel = channelForPaymentMethod(ctx.binding.paymentMethod.id);
  if (channel) return { paymentMethod: "va", channelId: channel };
  if (ctx.binding.paymentMethod.id === "qris") {
    return { paymentMethod: "qris", channelId: QRIS_CHANNEL };
  }
  return null;
}

// A quote is trusted only when its own arithmetic closes: the base amount is
// the one asked for, the fees deducted from the mint explain the whole gap
// between base and `toBeMinted`, and the fees added to the payment explain
// the whole gap between base and `paymentAmount`. Anything else is a
// mismatch, never something to display.
function readQuote(
  data: JsonRecord,
  input: QuoteIntent,
  ctx: ProviderContext,
  channel: { paymentMethod: "va" | "qris"; channelId: string },
): Quote {
  const decimals = ctx.binding.asset.decimals;
  assertOptionalExactString(data.paymentMethod, channel.paymentMethod);
  assertOptionalExactString(data.channelId, channel.channelId);
  assertOptionalInteger(data.chainId, ctx.binding.asset.chainId);
  const baseAtomic = idrxAtomicAmount(readDecimal(data.baseAmount), decimals);
  const expectedAtomic = idrxAtomicAmount(input.fiatAmount, decimals);
  if (baseAtomic === null || expectedAtomic === null || baseAtomic !== expectedAtomic) {
    throw new Error("IDRX quoted a different base amount.");
  }
  const mintedAtomic = idrxAtomicAmount(readDecimal(data.toBeMinted), decimals);
  const paymentAtomic = idrxAtomicAmount(readDecimal(data.paymentAmount), decimals);
  if (mintedAtomic === null || paymentAtomic === null || mintedAtomic <= BigInt(0) || mintedAtomic > baseAtomic || paymentAtomic < baseAtomic) {
    throw new Error("IDRX quote amounts are outside the requested amount.");
  }
  if (!Array.isArray(data.fees) || data.fees.length > 20) throw new Error("Invalid IDRX quote fees.");
  let deducted = BigInt(0);
  let added = BigInt(0);
  const fees: Quote["fees"] = [];
  for (const fee of data.fees) {
    if (!isRecord(fee)) throw new Error("Invalid IDRX quote fee.");
    const amount = readDecimal(fee.amount);
    const atomic = idrxAtomicAmount(amount, decimals);
    if (atomic === null || atomic < BigInt(0)) throw new Error("Invalid IDRX quote fee amount.");
    if (fee.appliedTo === "toBeMinted") deducted += atomic;
    else if (fee.appliedTo === "paymentAmount") added += atomic;
    else throw new Error("Invalid IDRX quote fee target.");
    fees.push({ label: readBoundedString(fee.name, 128), amount, currency: "IDR" });
  }
  if (baseAtomic - mintedAtomic !== deducted || paymentAtomic - baseAtomic !== added) {
    throw new Error("IDRX quote fees do not add up.");
  }
  return {
    fiatAmount: input.fiatAmount,
    tokenAmountAtomic: mintedAtomic.toString(10),
    fees,
    feesKnown: true,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
  };
}

function channelForPaymentMethod(id: string): "MANDIRI" | "BRI" | null {
  if (id === "bank-va-mandiri") return "MANDIRI";
  if (id === "bank-va-bri") return "BRI";
  return null;
}

async function classifyCreateFailure(response: Response): Promise<CreateOrderResult> {
  if (response.status === 401 || response.status === 403) {
    return {
      outcome: "rejected",
      message: "IDRX rejected the provider credentials or account eligibility.",
    };
  }
  if (response.status !== 400 && response.status !== 422) {
    return { outcome: "ambiguous" };
  }
  try {
    const payload = parseProviderJson(await readBoundedText(response));
    if (!isRecord(payload)) return { outcome: "ambiguous" };
    if (
      payload.statusCode !== undefined &&
      payload.statusCode !== response.status
    ) {
      return { outcome: "ambiguous" };
    }
    const message = typeof payload.message === "string" ? payload.message : "";
    // IDRX attaches a machine-readable `data.code` (for example
    // `BANK_ACCOUNT_REQUIRED` when a VA channel needs a registered bank
    // account) to validation rejections. No order exists in that case.
    if (
      response.status === 400 &&
      isRecord(payload.data) &&
      typeof payload.data.code === "string" &&
      /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.data.code)
    ) {
      return { outcome: "rejected", message: rejectionCopy(payload.data.code) };
    }
    if (!isDocumentedDefinitiveCreateError(response.status, message)) {
      return { outcome: "ambiguous" };
    }
    return { outcome: "rejected", message: "IDRX rejected the funding order." };
  } catch {
    return { outcome: "ambiguous" };
  }
}

// The core stores the rejection message as providerStatus and shows it to
// the user, so provider text never passes through; coded rejections map to
// Home copy the user can act on.
function rejectionCopy(code: string): string {
  if (code === "BANK_ACCOUNT_REQUIRED") {
    return "This bank transfer option is not available for this account yet. Choose another way to pay.";
  }
  return "IDRX rejected the funding order.";
}

function isDocumentedDefinitiveCreateError(
  status: number,
  message: string,
): boolean {
  if (
    status === 400 &&
    (
      /^paymentMethod must be "va" or "qris" when set, got: .+$/.test(message) ||
      message === "channelId is required when paymentMethod is set" ||
      /^invalid toBeMinted: IDRX on chainId \d+ supports \d+ decimal place\(s\), got .+$/.test(
        message,
      )
    )
  ) {
    return true;
  }
  return (
    (status === 400 || status === 422) &&
    /^Unsupported VA channel: .+$/.test(message)
  );
}

type PaymentEchoes = {
  fees: ProviderOrder["fees"];
  paymentAmount: string;
};

function assertCreateEchoes(
  data: JsonRecord,
  input: OrderIntent,
  ctx: ProviderContext,
  providerOrderId: string,
  expectedAtomic: bigint,
  channel: "MANDIRI" | "BRI" | null,
): PaymentEchoes | null {
  assertOrderIdAliases(data, providerOrderId, true);
  assertReferenceAliases(data, providerOrderId);
  assertChainAliases(data, ctx.binding.asset.chainId);
  assertTokenAliases(data, ctx);
  assertDestinationAliases(data, input.destination);
  assertAmountAliases(
    data,
    expectedAtomic,
    ctx.binding.asset.decimals,
  );
  assertTransactionTypeAliases(data, "MINT");
  assertRailEchoes(data, channel, channel !== null);
  readTransactionHash(data);
  return readPaymentEchoes(
    data,
    expectedAtomic,
    ctx.binding.asset.decimals,
    channel !== null,
  );
}

function readPaymentEchoes(
  data: JsonRecord,
  expectedAtomic: bigint,
  decimals: number,
  required: boolean,
): PaymentEchoes | null {
  const hasBaseAmount = data.baseAmount !== undefined;
  const hasPaymentAmount = data.amount !== undefined;
  const hasFees = data.fees !== undefined;
  if (!hasBaseAmount && !hasPaymentAmount && !hasFees) {
    if (required) throw new Error("Missing IDRX payment echoes.");
    return null;
  }
  if (!hasBaseAmount || !hasPaymentAmount || !hasFees) {
    throw new Error("Incomplete IDRX payment echoes.");
  }
  assertOptionalAtomicAmount(data.baseAmount, expectedAtomic, decimals);
  const fees = readFees(data.fees);
  const paymentAmount = readDecimal(data.amount);
  assertPaymentAmount(paymentAmount, expectedAtomic, fees, decimals);
  return { fees, paymentAmount };
}

// Live history records carry `paymentAmount` (what the user pays) and
// `fees[]`; the invariant is paymentAmount = toBeMinted + sum(fees), whether
// a fee is added on top (VA) or deducted from the mint (hosted QRIS).
function readHistoryPaymentEchoes(
  data: JsonRecord,
  settledAtomic: bigint,
  decimals: number,
): ProviderOrder["fees"] | null {
  const paymentValues = [data.paymentAmount, data.amount].filter(
    (value) => value !== undefined,
  );
  const hasFees = data.fees !== undefined;
  if (paymentValues.length === 0 && !hasFees) return null;
  if (paymentValues.length === 0 || !hasFees) {
    throw new Error("Incomplete IDRX history payment echoes.");
  }
  const normalized = new Set(paymentValues.map(readDecimal));
  if (normalized.size !== 1) throw new Error("Conflicting IDRX payment amounts.");
  const fees = readFees(data.fees);
  assertPaymentAmount([...normalized][0] as string, settledAtomic, fees, decimals);
  return fees;
}

// A lowered mint is only acceptable when the record itemizes fees that cover
// the shortfall, and the shortfall stays within a small share of the request.
function assertBoundedShortfall(
  expectedAtomic: bigint,
  settledAtomic: bigint,
  fees: ProviderOrder["fees"] | null,
  decimals: number,
): void {
  if (fees === null) {
    throw new Error("IDRX lowered the mint without itemized fees.");
  }
  const feeAtomic = fees.reduce((total, fee) => {
    const atomic = idrxAtomicAmount(fee.amount, decimals);
    if (atomic === null) throw new Error("Invalid IDRX fee amount.");
    return total + atomic;
  }, BigInt(0));
  const shortfall = expectedAtomic - settledAtomic;
  if (shortfall > feeAtomic) {
    throw new Error("IDRX shortfall exceeds the itemized fees.");
  }
  if (shortfall * BigInt(10_000) > expectedAtomic * MAX_SETTLEMENT_SHORTFALL_BASIS_POINTS) {
    throw new Error("IDRX shortfall exceeds the settlement cap.");
  }
}

function assertPaymentAmount(
  value: string,
  baseAtomic: bigint,
  fees: ProviderOrder["fees"],
  decimals: number,
): void {
  const paymentAtomic = idrxAtomicAmount(value, decimals);
  const feeAtomic = fees.reduce((total, fee) => {
    const atomic = idrxAtomicAmount(fee.amount, decimals);
    if (atomic === null) throw new Error("Invalid IDRX fee amount.");
    return total + atomic;
  }, BigInt(0));
  if (paymentAtomic !== baseAtomic + feeAtomic) {
    throw new Error("IDRX payment amount mismatch.");
  }
}

function assertOrderIdAliases(
  data: JsonRecord,
  expected: string,
  required: boolean,
): void {
  const values = [
    data.merchantOrderId,
    data.merchantOrderID,
    data.providerOrderId,
    data.providerOrderID,
    data.orderId,
    data.orderID,
  ];
  const available = values.filter((value) => value !== undefined);
  if (required && available.length === 0) {
    throw new Error("Missing IDRX order ID.");
  }
  for (const value of available) assertOptionalExactString(value, expected);
}

function assertReferenceAliases(data: JsonRecord, providerOrderId: string): void {
  if (data.reference !== undefined) {
    assertOptionalExactString(data.reference, `SNAP-${providerOrderId}`);
  }
}

function assertChainAliases(data: JsonRecord, expected: number): void {
  for (const value of [data.chainId, data.networkChainId, data.destinationChainId]) {
    assertOptionalInteger(value, expected);
  }
}

function assertTokenAliases(data: JsonRecord, ctx: ProviderContext): void {
  for (const value of [data.tokenAddress, data.contractAddress, data.assetAddress]) {
    assertOptionalAddress(value, ctx.binding.asset.address);
  }
  for (const value of [data.tokenSymbol, data.symbol]) {
    assertOptionalExactString(value, ctx.binding.asset.symbol);
  }
  if (
    data.requestType !== undefined &&
    data.requestType !== "" &&
    data.requestType !== "idrx"
  ) {
    throw new Error("IDRX token echo mismatch.");
  }
}

function assertDestinationAliases(
  data: JsonRecord,
  expected: `0x${string}`,
): void {
  for (const value of [
    data.destinationWalletAddress,
    data.destinationAddress,
    data.destination,
  ]) {
    assertOptionalAddress(value, expected);
  }
}

function assertAmountAliases(
  data: JsonRecord,
  expectedAtomic: bigint,
  decimals: number,
): void {
  for (const value of [data.toBeMinted, data.baseAmount]) {
    assertOptionalAtomicAmount(value, expectedAtomic, decimals);
  }
  for (const value of [
    data.expectedTokenAmountAtomic,
    data.tokenAmountAtomic,
    data.amountAtomic,
  ]) {
    assertOptionalAtomicString(value, expectedAtomic);
  }
  for (const value of [data.decimals, data.tokenDecimals, data.assetDecimals]) {
    assertOptionalInteger(value, decimals);
  }
}

function assertTransactionTypeAliases(
  data: JsonRecord,
  expected: "MINT",
): void {
  for (const value of [data.transactionType, data.txType]) {
    assertOptionalExactString(value, expected);
  }
}

function assertRailEchoes(
  data: JsonRecord,
  channel: "MANDIRI" | "BRI" | null,
  requirePaymentMethod = false,
): void {
  const paymentMethod = channel ? "va" : "qris";
  if (requirePaymentMethod && data.paymentMethod === undefined) {
    throw new Error("Missing IDRX payment method echo.");
  }
  assertOptionalExactString(data.paymentMethod, paymentMethod);
  if (data.rail !== undefined) {
    const allowedRails = channel
      ? ["va", "bank-va", "virtual-account"]
      : ["qris", "redirect", "hosted"];
    if (typeof data.rail !== "string" || !allowedRails.includes(data.rail)) {
      throw new Error("IDRX rail echo mismatch.");
    }
  }
  if (channel) assertOptionalExactString(data.channelId, channel);
  else if (data.channelId !== undefined) {
    throw new Error("IDRX channel echo mismatch.");
  }
}

function assertOptionalExactString(value: unknown, expected: string): void {
  if (value === undefined) return;
  if (value !== expected) throw new Error("IDRX string echo mismatch.");
}

function assertOptionalInteger(value: unknown, expected: number): void {
  if (value === undefined) return;
  if (
    (typeof value !== "number" || !Number.isSafeInteger(value)) &&
    (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value))
  ) {
    throw new Error("IDRX integer echo is invalid.");
  }
  if (BigInt(value) !== BigInt(expected)) {
    throw new Error("IDRX integer echo mismatch.");
  }
}

function assertOptionalAddress(value: unknown, expected: `0x${string}`): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    value.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error("IDRX address echo mismatch.");
  }
}

function assertOptionalAtomicAmount(
  value: unknown,
  expected: bigint,
  decimals: number,
): void {
  if (value === undefined) return;
  if (idrxAtomicAmount(readDecimal(value), decimals) !== expected) {
    throw new Error("IDRX amount echo mismatch.");
  }
}

function assertOptionalAtomicString(value: unknown, expected: bigint): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    BigInt(value) !== expected
  ) {
    throw new Error("IDRX atomic amount echo mismatch.");
  }
}

function createRequestHeaders(
  ctx: ProviderContext,
  method: string,
  url: string,
  body: string,
): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "home/idrx-funding-adapter",
    "idrx-api-key": ctx.env.IDRX_CLIENT_ID,
    "idrx-api-sig": createIdrxSignature({
      method,
      url,
      body,
      timestamp,
      secretKey: ctx.env.IDRX_CLIENT_SECRET,
    }),
    "idrx-api-ts": timestamp,
  };
}

export function createIdrxSignature(options: {
  method: string;
  url: string;
  body: string;
  timestamp: string;
  secretKey: string;
}): string {
  const hmac = createHmac(
    "sha256",
    Buffer.from(options.secretKey, "base64"),
  );
  hmac.update(options.timestamp);
  hmac.update(options.method);
  hmac.update(options.url);
  if (options.body) hmac.update(options.body);
  return hmac.digest("base64url");
}

function created(order: ProviderOrder): CreateOrderResult {
  return { outcome: "created", order };
}

function isValidReconciliationIntent(
  input: ReconciliationIntent,
  ctx: ProviderContext,
): boolean {
  return (
    orderIdPattern.test(input.providerOrderId) &&
    input.transactionType === "MINT" &&
    input.chainId === ctx.binding.asset.chainId &&
    input.tokenAddress.toLowerCase() === ctx.binding.asset.address.toLowerCase() &&
    input.tokenDecimals === ctx.binding.asset.decimals &&
    /^0x[0-9a-fA-F]{40}$/.test(input.destination) &&
    /^(?:0|[1-9]\d*)$/.test(input.expectedTokenAmountAtomic)
  );
}

type Settlement = {
  settledAtomic: bigint;
  expectedAtomic: bigint;
  fees: ProviderOrder["fees"];
};

// A provider may lower the settled amount only by fees it itemizes, and the
// deduction may not exceed this share of the requested amount. IDRX deducts
// the 0.7% QRIS fee from the mint; flat channel fees are paid on top and do
// not lower it, so the cap is on the shortfall, not on the fee total.
const MAX_SETTLEMENT_SHORTFALL_BASIS_POINTS = BigInt(500);

// Validates a history record against the immutable intent and returns the
// amount IDRX will actually mint. IDRX deducts a channel fee from the minted
// amount for hosted QRIS (0.7% on 2026-09-14), so `toBeMinted` in the record
// can be lower than the requested amount; it can never be higher.
function readReconciliationSettlement(
  record: JsonRecord,
  input: ReconciliationIntent,
  ctx: ProviderContext,
): Settlement | null {
  try {
    // `expectedTokenAmountAtomic` is the amount the core will verify on Base:
    // the quoted net mint when the order was quoted, the requested amount
    // otherwise. IDRX's record still speaks in the requested amount
    // (`baseAmount`) minus the fee it deducted, so the record is checked
    // against the requested amount and the settlement against the expected one.
    const expectedAtomic = BigInt(input.expectedTokenAmountAtomic);
    const requestedAtomic = input.fiatAmount === undefined
      ? expectedAtomic
      : idrxAtomicAmount(input.fiatAmount, input.tokenDecimals);
    if (requestedAtomic === null || requestedAtomic < expectedAtomic) {
      throw new Error("IDRX requested amount below the expected amount.");
    }
    assertOrderIdAliases(record, input.providerOrderId, true);
    assertReferenceAliases(record, input.providerOrderId);
    assertTransactionTypeAliases(record, input.transactionType);
    assertChainAliases(record, input.chainId);
    assertTokenAliases(record, ctx);
    assertDestinationAliases(record, input.destination);
    const settledAtomic = readSettledAmount(
      record,
      requestedAtomic,
      input.tokenDecimals,
    );
    const fees = readHistoryPaymentEchoes(record, settledAtomic, input.tokenDecimals);
    if (settledAtomic < requestedAtomic) {
      assertBoundedShortfall(requestedAtomic, settledAtomic, fees, input.tokenDecimals);
    }
    assertRailEchoes(
      record,
      channelForPaymentMethod(ctx.binding.paymentMethod.id),
    );
    readCheckoutUrlEchoes(record, false);
    readTransactionHash(record);
    return { settledAtomic, expectedAtomic, fees: fees ?? [] };
  } catch {
    return null;
  }
}

function readSettledAmount(
  record: JsonRecord,
  requestedAtomic: bigint,
  decimals: number,
): bigint {
  for (const value of [record.decimals, record.tokenDecimals, record.assetDecimals]) {
    assertOptionalInteger(value, decimals);
  }
  assertOptionalAtomicAmount(record.baseAmount, requestedAtomic, decimals);
  let settled = requestedAtomic;
  if (record.toBeMinted !== undefined) {
    const minted = idrxAtomicAmount(readDecimal(record.toBeMinted), decimals);
    if (minted === null || minted <= BigInt(0) || minted > requestedAtomic) {
      throw new Error("IDRX settled amount outside the requested amount.");
    }
    settled = minted;
  }
  for (const value of [
    record.expectedTokenAmountAtomic,
    record.tokenAmountAtomic,
    record.amountAtomic,
  ]) {
    assertOptionalAtomicString(value, settled);
  }
  return settled;
}

function observationFromRecord(
  record: JsonRecord,
  settlement: Settlement,
): Observation {
  const settled = settlement.settledAtomic === settlement.expectedAtomic
    ? {}
    : {
        settledTokenAmountAtomic: settlement.settledAtomic.toString(10),
        fees: settlement.fees,
      };
  const mint = typeof record.userMintStatus === "string"
    ? record.userMintStatus
    : "INVALID";
  const payment = typeof record.paymentStatus === "string"
    ? record.paymentStatus
    : "INVALID";
  const providerStatus = `${mint}:${payment}`;
  if (mint === "MINTED" && payment === "PAID") {
    const transactionHash = readTransactionHash(record);
    return {
      state: "sent",
      providerStatus,
      ...settled,
      ...(transactionHash ? { transactionHash } : {}),
    };
  }
  if (mint === "PROCESSING" && payment === "PAID") {
    return { state: "settling", providerStatus, ...settled };
  }
  if (mint === "NOT_AVAILABLE" && payment === "WAITING_FOR_PAYMENT") {
    return { state: "awaiting-payment", providerStatus };
  }
  if (mint === "NOT_AVAILABLE" && payment === "EXPIRED") {
    return { state: "expired", providerStatus };
  }
  if (mint === "REJECTED" && payment === "PAID") {
    return { state: "failed", providerStatus };
  }
  if (mint === "REFUND" && payment === "PAID") {
    return { state: "refunded", providerStatus };
  }
  return unknown(providerStatus);
}

function unknown(providerStatus: string): Observation {
  return { state: "unknown", providerStatus };
}

function readTransactionHash(record: JsonRecord): `0x${string}` | null {
  const values = [record.transactionHash, record.txHash].filter(
    (value) => value !== undefined,
  );
  if (values.length === 0 || values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Conflicting IDRX transaction hashes.");
  }
  const normalized = values.map((value) => {
    if (typeof value !== "string" || !transactionHashPattern.test(value)) {
      throw new Error("Invalid IDRX transaction hash.");
    }
    return value.toLowerCase() as `0x${string}`;
  });
  if (new Set(normalized).size !== 1) {
    throw new Error("Conflicting IDRX transaction hashes.");
  }
  return normalized[0] ?? null;
}

function readCheckoutUrlEchoes(
  data: JsonRecord,
  required: boolean,
): string | null {
  const values = [data.checkoutUrl, data.paymentUrl, data.instructionUrl]
    .filter((value) => value !== undefined);
  if (values.length === 0) {
    if (required) throw new Error("Missing IDRX checkout URL.");
    return null;
  }
  const normalized = values.map(readCheckoutUrl);
  if (new Set(normalized).size !== 1) {
    throw new Error("Conflicting IDRX checkout URLs.");
  }
  return normalized[0] ?? null;
}

function readCheckoutUrl(value: unknown): string {
  const raw = readBoundedString(value, 4096);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.origin !== IDRX_CHECKOUT_ORIGIN ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !url.searchParams.get("token") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Invalid IDRX checkout URL.");
  }
  return url.toString();
}

function readFees(value: unknown): ProviderOrder["fees"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Invalid IDRX fees.");
  }
  return value.map((fee) => {
    if (!isRecord(fee)) throw new Error("Invalid IDRX fee.");
    if (fee.currency !== undefined) {
      assertOptionalExactString(fee.currency, "IDR");
    }
    return {
      label: readBoundedString(fee.name, 128),
      amount: readDecimal(fee.amount),
      currency: "IDR",
    };
  });
}

function readData(value: unknown): JsonRecord {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Invalid IDRX response.");
  }
  return value.data;
}

function readOrderId(value: unknown): string {
  const orderId = readBoundedString(value, 128);
  if (!orderIdPattern.test(orderId)) throw new Error("Invalid IDRX order ID.");
  return orderId;
}

function readExpiry(value: unknown): string {
  const expiry = readBoundedString(value, 128);
  if (!Number.isFinite(Date.parse(expiry))) throw new Error("Invalid IDRX expiry.");
  return expiry;
}

// The live IDRX API serialises amounts as JSON numbers (`"toBeMinted": 19860`,
// `"paymentAmount": 23000`); fee entries and older responses use strings.
function readDecimal(value: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value;
  if (
    typeof text !== "string" ||
    text.length > MAX_IDRX_DECIMAL_LENGTH ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)
  ) {
    throw new Error("Invalid decimal amount.");
  }
  return text;
}

function readOptionalReference(value: unknown): { reference?: string } {
  if (value === undefined || value === null || value === "") return {};
  return { reference: readBoundedString(value, 128) };
}

export function idrxAtomicAmount(value: string, decimals: number): bigint | null {
  if (value.length > 128 || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    return null;
  }
  try {
    return BigInt(decimalToAtomic(value, decimals));
  } catch {
    return null;
  }
}


function readBoundedString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error("Invalid provider string.");
  }
  return value;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    BigInt(declaredLength) > BigInt(MAX_RESPONSE_BYTES)
  ) {
    throw new Error("IDRX response is too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let deadlineCleanup: () => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    const timeout = setTimeout(() => {
      void reader.cancel("IDRX response body timed out.");
      reject(new Error("IDRX response body timed out."));
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
        await reader.cancel("IDRX response is too large.");
        throw new Error("IDRX response is too large.");
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
  const decimalKeys = new Set(["amount", "baseAmount"]);
  let output = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '"') {
      output += text[index];
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        break;
      }
      index += 1;
    }
    const token = text.slice(start, index);
    output += token;
    let cursor = index;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== ":") continue;
    let key: unknown;
    try {
      key = JSON.parse(token);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !decimalKeys.has(key)) continue;
    output += text.slice(index, cursor + 1);
    cursor += 1;
    const whitespaceStart = cursor;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    output += text.slice(whitespaceStart, cursor);
    const numeric = /^(?:0|[1-9]\d*)(?:\.\d+)?/.exec(text.slice(cursor));
    if (!numeric) {
      index = cursor;
      continue;
    }
    output += JSON.stringify(numeric[0]);
    index = cursor + numeric[0].length;
  }
  return JSON.parse(output);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
