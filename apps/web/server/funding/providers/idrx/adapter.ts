import { createHmac } from "node:crypto";
import type {
  CreateOrderResult,
  FundingProvider,
  Observation,
  OrderIntent,
  ProviderContext,
  ProviderOrder,
  ReconciliationIntent,
} from "@/shared/funding/provider-contract";
import { IDRX_API_ORIGIN, IDRX_CHECKOUT_ORIGIN, idrxManifest } from "./manifest";

const MINT_PATH = "/transaction/mint-request";
const HISTORY_PATH = "/transaction/user-transaction-history";
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

  async createOrder(input, ctx) {
    const atomic = input.fiatAmount.length <= MAX_IDRX_DECIMAL_LENGTH
      ? decimalToAtomic(input.fiatAmount, ctx.binding.asset.decimals)
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
      const common = {
        providerOrderId,
        tokenAddress: ctx.binding.asset.address,
        expectedTokenAmountAtomic: atomic.toString(10),
      } as const;

      if (ctx.binding.paymentMethod.id === "qris") {
        if (!checkoutUrl) throw new Error("Missing IDRX checkout URL.");
        return created({
          ...common,
          fees: paymentEchoes?.fees ?? [],
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
      const expectedCustomerName = normalizeCustomerName(ctx.env.IDRX_CUSTOMER_NAME);
      if (normalizeCustomerName(accountName) !== expectedCustomerName) {
        throw new Error("IDRX customer mismatch.");
      }
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
      if (!recordMatchesReconciliationIntent(record, input, ctx)) {
        return unknown("INTENT_MISMATCH");
      }
      return observationFromRecord(record);
    } catch {
      return unknown("INVALID_RESPONSE");
    }
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
    return { ...common, returnUrl: input.returnUrl };
  }
  return null;
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
    if (!isDocumentedDefinitiveCreateError(response.status, message)) {
      return { outcome: "ambiguous" };
    }
    return { outcome: "rejected", message: "IDRX rejected the funding order." };
  } catch {
    return { outcome: "ambiguous" };
  }
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

function assertHistoryPaymentEchoes(
  data: JsonRecord,
  expectedAtomic: bigint,
  decimals: number,
): void {
  const hasPaymentAmount = data.amount !== undefined;
  const hasFees = data.fees !== undefined;
  if (!hasPaymentAmount && !hasFees) return;
  if (!hasPaymentAmount || !hasFees) {
    throw new Error("Incomplete IDRX history payment echoes.");
  }
  const fees = readFees(data.fees);
  const paymentAmount = readDecimal(data.amount);
  assertPaymentAmount(paymentAmount, expectedAtomic, fees, decimals);
}

function assertPaymentAmount(
  value: string,
  baseAtomic: bigint,
  fees: ProviderOrder["fees"],
  decimals: number,
): void {
  const paymentAtomic = decimalToAtomic(value, decimals);
  const feeAtomic = fees.reduce((total, fee) => {
    const atomic = decimalToAtomic(fee.amount, decimals);
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
  if (decimalToAtomic(readDecimal(value), decimals) !== expected) {
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

function recordMatchesReconciliationIntent(
  record: JsonRecord,
  input: ReconciliationIntent,
  ctx: ProviderContext,
): boolean {
  try {
    const expectedAtomic = BigInt(input.expectedTokenAmountAtomic);
    assertOrderIdAliases(record, input.providerOrderId, true);
    assertReferenceAliases(record, input.providerOrderId);
    assertTransactionTypeAliases(record, input.transactionType);
    assertChainAliases(record, input.chainId);
    assertTokenAliases(record, ctx);
    assertDestinationAliases(record, input.destination);
    assertAmountAliases(record, expectedAtomic, input.tokenDecimals);
    assertHistoryPaymentEchoes(record, expectedAtomic, input.tokenDecimals);
    assertRailEchoes(
      record,
      channelForPaymentMethod(ctx.binding.paymentMethod.id),
    );
    readCheckoutUrlEchoes(record, false);
    readTransactionHash(record);
    return true;
  } catch {
    return false;
  }
}

function observationFromRecord(record: JsonRecord): Observation {
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
      ...(transactionHash ? { transactionHash } : {}),
    };
  }
  if (mint === "PROCESSING" && payment === "PAID") {
    return { state: "settling", providerStatus };
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

function readDecimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_IDRX_DECIMAL_LENGTH ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new Error("Invalid decimal amount.");
  }
  return value;
}

function readOptionalReference(value: unknown): { reference?: string } {
  if (value === undefined || value === null || value === "") return {};
  return { reference: readBoundedString(value, 128) };
}

function decimalToAtomic(value: string, decimals: number): bigint | null {
  if (
    value.length > 128 ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]) * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
}

function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
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
