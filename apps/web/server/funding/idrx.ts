import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import {
  FUNDING_BASE_CHAIN_ID as IDRX_BASE_CHAIN_ID,
  IDRX_BASE_ADDRESS,
  IDRX_DECIMALS,
  type IdrxFundingRail,
  type IdrxHostedMint,
  type IdrxMintAsset,
  type IdrxMintResult,
  type IdrxVaChannel,
  type IdrxVirtualAccountMint,
} from "@/shared/funding/types";
import { createIdrxRequestHeaders } from "./idrx-hmac";

export { IDRX_BASE_ADDRESS, IDRX_BASE_CHAIN_ID, IDRX_DECIMALS };
export const IDRX_API_BASE_URL = "https://api.idrx.co" as const;
export const IDRX_MINT_PATH = "/transaction/mint-request" as const;
export const IDRX_HISTORY_PATH = "/transaction/user-transaction-history" as const;
export const IDRX_VA_CHANNELS = ["MANDIRI", "BRI"] as const;
export const IDRX_MIN_TO_BE_MINTED_MINOR = BigInt(2_000_000);
export const IDRX_MAX_TO_BE_MINTED_MINOR = BigInt("100000000000");

export class IdrxMintError extends Error {
  readonly code: "not-configured" | "unavailable" | "invalid-response";

  constructor(code: IdrxMintError["code"], cause?: unknown) {
    super(code, { cause });
    this.name = "IdrxMintError";
    this.code = code;
  }
}

export type IdrxCustomerBinding = {
  subject: string;
  customerName: string;
};

export type IdrxMintReconciliation = "pending" | "minted" | "expired" | "failed";

export type ReadIdrxMintStatus = (options: {
  customer: IdrxCustomerBinding;
  merchantOrderId: string;
  signal?: AbortSignal;
}) => Promise<IdrxMintReconciliation>;

export type CreateIdrxMintRequest = (options: {
  address: `0x${string}`;
  customer: IdrxCustomerBinding;
  toBeMinted: string;
  rail: IdrxFundingRail;
  channelId?: IdrxVaChannel;
  returnUrl: string;
  signal?: AbortSignal;
}) => Promise<IdrxMintResult>;

type Environment = Record<string, string | undefined>;
type IdrxFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const mintAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const merchantOrderIdPattern = /^[\x21-\x7e]{1,128}$/;
const virtualAccountPattern = /^[0-9]{8,32}$/;
const checkoutHost = "checkout.idrx.co";

export function assertIdrxBaseToken(): IdrxMintAsset {
  const registered = verifiedLocalCashAssets.IDR;
  if (
    registered.decimals !== IDRX_DECIMALS ||
    registered.contractAddress.toLowerCase() !== IDRX_BASE_ADDRESS.toLowerCase()
  ) {
    throw new Error("IDRX Base token identity drifted from the funding client.");
  }
  return {
    id: "idrx",
    symbol: "IDRX",
    decimals: IDRX_DECIMALS,
    tokenAddress: IDRX_BASE_ADDRESS,
  };
}

export function isIdrxVaChannel(value: unknown): value is IdrxVaChannel {
  return value === "MANDIRI" || value === "BRI";
}

export function parseIdrxMintAmount(value: string): string {
  if (!mintAmountPattern.test(value)) {
    throw new IdrxMintError("invalid-response");
  }
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (minor < IDRX_MIN_TO_BE_MINTED_MINOR || minor > IDRX_MAX_TO_BE_MINTED_MINOR) {
    throw new IdrxMintError("invalid-response");
  }
  return value;
}

export function isAllowedIdrxMintAmount(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseIdrxMintAmount(value);
    return true;
  } catch {
    return false;
  }
}

// TODO(live-keys): After Jesse's IDRX dashboard key lands (individual signup →
// business docs to support@idrx.co → API Key), smoke outside CI:
// 1. POST /transaction/mint-request with networkChainId=8453
// 2. VA Flow B paymentMethod=va + MANDIRI (then BRI)
// 3. Confirm HMAC 200; if 401, compare against the mint-request page formula
// 4. Confirm VA number or https://checkout.idrx.co hosted URL
// 5. Do not enable live issuer calls in pull-request CI
export function createIdrxMintClient(options: {
  env?: Environment;
  fetchImplementation?: IdrxFetch;
  now?: () => number;
} = {}): CreateIdrxMintRequest {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  const asset = assertIdrxBaseToken();

  return async ({ address, customer, toBeMinted, rail, channelId, returnUrl, signal }) => {
    const clientId = env.IDRX_CLIENT_ID?.trim();
    const clientSecret = env.IDRX_CLIENT_SECRET?.trim();
    const configuredSubject = env.IDRX_CUSTOMER_SUBJECT?.trim();
    const configuredName = env.IDRX_CUSTOMER_NAME?.trim();
    if (
      !clientId ||
      !clientSecret ||
      !configuredSubject ||
      !configuredName ||
      configuredSubject !== customer.subject ||
      normalizeCustomerName(configuredName) !== normalizeCustomerName(customer.customerName)
    ) {
      throw new IdrxMintError("not-configured");
    }
    parseIdrxMintAmount(toBeMinted);

    if (rail === "qris") {
      const hosted = await postMint({
        apiKey: clientId,
        secretKey: clientSecret,
        fetchImplementation,
        now,
        signal,
        body: hostedMintBody(toBeMinted, address, returnUrl),
      });
      if (hosted.kind === "ok") return parseHostedMint(hosted.data, asset);
      throw hosted.error;
    }
    if (rail !== "bank-va" || !channelId || !isIdrxVaChannel(channelId)) {
      throw new IdrxMintError("invalid-response");
    }

    const va = await postMint({
      apiKey: clientId,
      secretKey: clientSecret,
      fetchImplementation,
      now,
      signal,
      body: vaMintBody(toBeMinted, address, channelId),
    });
    if (va.kind === "ok") {
      return parseMintData(va.data, {
        asset,
        preferredChannel: channelId,
        expectedCustomerName: customer.customerName,
        allowHosted: false,
      });
    }
    throw va.error;
  };
}

export const createIdrxMintRequest = createIdrxMintClient();

export function createIdrxMintStatusReader(options: {
  env?: Environment;
  fetchImplementation?: IdrxFetch;
  now?: () => number;
} = {}): ReadIdrxMintStatus {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  return async ({ customer, merchantOrderId, signal }) => {
    const clientId = env.IDRX_CLIENT_ID?.trim();
    const clientSecret = env.IDRX_CLIENT_SECRET?.trim();
    const configuredSubject = env.IDRX_CUSTOMER_SUBJECT?.trim();
    const configuredName = env.IDRX_CUSTOMER_NAME?.trim();
    if (!clientId || !clientSecret || configuredSubject !== customer.subject ||
      !configuredName || normalizeCustomerName(configuredName) !== normalizeCustomerName(customer.customerName)) {
      throw new IdrxMintError("not-configured");
    }
    if (!merchantOrderIdPattern.test(merchantOrderId)) throw new IdrxMintError("invalid-response");
    const url = new URL(IDRX_HISTORY_PATH, IDRX_API_BASE_URL);
    url.searchParams.set("merchantOrderId", merchantOrderId);
    const timestamp = String(now());
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "GET",
        headers: createIdrxRequestHeaders({
          apiKey: clientId,
          secretKey: clientSecret,
          method: "GET",
          url: url.toString(),
          body: "",
          timestamp,
        }),
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw new IdrxMintError("unavailable", error);
    }
    if (!response.ok) throw new IdrxMintError("unavailable");
    let payload: unknown;
    try { payload = JSON.parse(await response.text()); }
    catch (error) { throw new IdrxMintError("invalid-response", error); }
    return parseIdrxMintStatus(payload, merchantOrderId);
  };
}

export const readIdrxMintStatus = createIdrxMintStatusReader();

export function resolveConfiguredIdrxCustomer(
  subject: string,
  env: Environment = process.env,
): IdrxCustomerBinding | null {
  const clientId = env.IDRX_CLIENT_ID?.trim();
  const clientSecret = env.IDRX_CLIENT_SECRET?.trim();
  const configuredSubject = env.IDRX_CUSTOMER_SUBJECT?.trim();
  const customerName = env.IDRX_CUSTOMER_NAME?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !configuredSubject ||
    !customerName ||
    configuredSubject !== subject
  ) return null;
  return { subject: configuredSubject, customerName };
}

function vaMintBody(
  toBeMinted: string,
  destinationWalletAddress: string,
  channelId: IdrxVaChannel,
) {
  return {
    toBeMinted,
    destinationWalletAddress,
    networkChainId: String(IDRX_BASE_CHAIN_ID),
    requestType: "idrx",
    expiryPeriod: 60,
    paymentMethod: "va",
    channelId,
  };
}

function hostedMintBody(
  toBeMinted: string,
  destinationWalletAddress: string,
  returnUrl: string,
) {
  return {
    toBeMinted,
    destinationWalletAddress,
    networkChainId: String(IDRX_BASE_CHAIN_ID),
    returnUrl,
    expiryPeriod: 60,
    requestType: "idrx",
  };
}

async function postMint(options: {
  apiKey: string;
  secretKey: string;
  fetchImplementation: IdrxFetch;
  now: () => number;
  signal?: AbortSignal;
  body: Record<string, unknown>;
}): Promise<
  | { kind: "ok"; data: unknown }
  | { kind: "va-unavailable"; error: IdrxMintError }
  | { kind: "fail"; error: IdrxMintError }
> {
  const url = `${IDRX_API_BASE_URL}${IDRX_MINT_PATH}`;
  const body = JSON.stringify(options.body);
  const timestamp = String(options.now());
  let response: Response;
  try {
    response = await options.fetchImplementation(url, {
      method: "POST",
      headers: createIdrxRequestHeaders({
        apiKey: options.apiKey,
        secretKey: options.secretKey,
        method: "POST",
        url,
        body,
        timestamp,
      }),
      body,
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    return { kind: "fail", error: new IdrxMintError("unavailable", error) };
  }

  if (response.ok) {
    try {
      return { kind: "ok", data: parseIdrxResponseJson(await response.text()) };
    } catch (error) {
      return { kind: "fail", error: new IdrxMintError("invalid-response", error) };
    }
  }

  if (isVaUnavailableStatus(response.status)) {
    return {
      kind: "va-unavailable",
      error: new IdrxMintError("unavailable"),
    };
  }
  return { kind: "fail", error: new IdrxMintError("unavailable") };
}

function isVaUnavailableStatus(status: number): boolean {
  return status === 400 || status === 422;
}

function parseMintData(
  value: unknown,
  options: {
    asset: IdrxMintAsset;
    preferredChannel: IdrxVaChannel;
    expectedCustomerName: string;
    allowHosted: boolean;
  },
): IdrxMintResult {
  const data = readData(value);
  const virtualAccountNo = data.virtualAccountNo;
  if (typeof virtualAccountNo === "string" && virtualAccountNo.length > 0) {
    return parseVirtualAccountMint(
      data,
      options.asset,
      options.preferredChannel,
      options.expectedCustomerName,
    );
  }
  if (options.allowHosted) return parseHostedMint(value, options.asset);
  throw new IdrxMintError("invalid-response");
}

function parseVirtualAccountMint(
  data: Record<string, unknown>,
  asset: IdrxMintAsset,
  channelId: IdrxVaChannel,
  expectedCustomerName: string,
): IdrxVirtualAccountMint {
  if (
    typeof data.virtualAccountNo !== "string" ||
    !virtualAccountPattern.test(data.virtualAccountNo) ||
    typeof data.virtualAccountName !== "string" ||
    data.virtualAccountName.trim().length === 0 ||
    data.virtualAccountName.length > 128 ||
    normalizeCustomerName(data.virtualAccountName) !==
      normalizeCustomerName(expectedCustomerName) ||
    typeof data.merchantOrderId !== "string" ||
    !merchantOrderIdPattern.test(data.merchantOrderId)
  ) {
    throw new IdrxMintError("invalid-response");
  }
  const expiredDate = readExpiredDate(data.expiredDate);
  return {
    presentation: "virtual-account",
    rail: "bank-va",
    asset,
    network: { name: "Base", chainId: IDRX_BASE_CHAIN_ID },
    merchantOrderId: data.merchantOrderId,
    reference: typeof data.reference === "string" ? data.reference : null,
    virtualAccountNo: data.virtualAccountNo,
    virtualAccountName: data.virtualAccountName.trim(),
    amount: readIdrAmount(data.amount),
    baseAmount: readIdrAmount(data.baseAmount),
    fees: readFees(data.fees),
    expiredDate,
    channelId,
    verification: { status: "pending", boundary: "balance-and-activity" },
  };
}

function parseHostedMint(value: unknown, asset: IdrxMintAsset): IdrxHostedMint {
  const data = readData(value);
  if (
    typeof data.merchantOrderId !== "string" ||
    !merchantOrderIdPattern.test(data.merchantOrderId)
  ) {
    throw new IdrxMintError("invalid-response");
  }
  const url = parseIdrxCheckoutUrl(data.checkoutUrl ?? data.paymentUrl);
  return {
    presentation: "hosted",
    rail: "qris",
    asset,
    network: { name: "Base", chainId: IDRX_BASE_CHAIN_ID },
    merchantOrderId: data.merchantOrderId,
    url,
    verification: { status: "pending", boundary: "balance-and-activity" },
  };
}

export function parseIdrxCheckoutUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new IdrxMintError("invalid-response");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IdrxMintError("invalid-response");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== checkoutHost ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !url.searchParams.get("token") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new IdrxMintError("invalid-response");
  }
  return url.toString();
}

function readData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new IdrxMintError("invalid-response");
  }
  return value.data;
}

function readFees(value: unknown): Array<{ name: string; amount: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new IdrxMintError("invalid-response");
  return value.map((fee) => {
    if (!isRecord(fee) || typeof fee.name !== "string" || fee.name.length === 0) {
      throw new IdrxMintError("invalid-response");
    }
    return { name: fee.name, amount: readIdrAmount(fee.amount) };
  });
}

function readIdrAmount(value: unknown): string {
  if (typeof value !== "string" || !mintAmountPattern.test(value)) {
    throw new IdrxMintError("invalid-response");
  }
  return value;
}

function parseIdrxResponseJson(text: string): unknown {
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
    const valueWhitespaceStart = cursor;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    output += text.slice(valueWhitespaceStart, cursor);
    const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(cursor),
    );
    if (!numeric) {
      index = cursor;
      continue;
    }
    output += JSON.stringify(numeric[0]);
    index = cursor + numeric[0].length;
  }
  return JSON.parse(output);
}

function parseIdrxMintStatus(
  value: unknown,
  merchantOrderId: string,
): IdrxMintReconciliation {
  if (!isRecord(value)) throw new IdrxMintError("invalid-response");
  const data = value.data;
  const records = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.records)
      ? data.records
      : isRecord(data)
        ? [data]
        : [];
  const matching = records.filter((record) =>
    isRecord(record) && record.merchantOrderId === merchantOrderId
  );
  if (matching.length === 0) return "pending";
  if (matching.length !== 1) throw new IdrxMintError("invalid-response");
  const record = matching[0] as Record<string, unknown>;
  const raw = record.userMintStatus ?? record.transactionStatus ?? record.status;
  if (typeof raw !== "string") throw new IdrxMintError("invalid-response");
  const status = raw.trim().toLocaleUpperCase("en-US");
  if (["MINTED", "SUCCESS", "COMPLETED"].includes(status)) return "minted";
  if (["EXPIRED", "CANCELLED", "CANCELED"].includes(status)) return "expired";
  if (["FAILED", "REJECTED", "REFUNDED", "REFUND"].includes(status)) return "failed";
  if (["PENDING", "PROCESSING", "PAID", "NOT_AVAILABLE"].includes(status)) return "pending";
  throw new IdrxMintError("invalid-response");
}

function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
}

function readExpiredDate(value: unknown): string {
  if (typeof value !== "string") throw new IdrxMintError("invalid-response");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new IdrxMintError("invalid-response");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
