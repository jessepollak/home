import {
  FUNDING_BASE_CHAIN_ID,
  FUNDING_BASE_USDC_ADDRESS,
  IDRX_BASE_ADDRESS,
  IDRX_COUNTRY,
  IDRX_DECIMALS,
  type HostedOnrampSession,
  type IdrxFundingRail,
  type IdrxMintResult,
  type IdrxVaChannel,
} from "./types";

export type FundingAccountResource = (
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<unknown>;

export class FundingRequestError extends Error {
  readonly code:
    | "unauthenticated"
    | "not-configured"
    | "pending"
    | "unavailable"
    | "invalid-response";

  constructor(code: FundingRequestError["code"]) {
    super(code);
    this.name = "FundingRequestError";
    this.code = code;
  }
}

export async function requestHostedOnrampSession(options: {
  fetchAccountResource: FundingAccountResource;
  signal?: AbortSignal;
}): Promise<HostedOnrampSession> {
  let value: unknown;
  try {
    value = await options.fetchAccountResource("/api/funding/onramp-session", {
      method: "POST",
      body: { assetId: "usdc" },
      signal: options.signal,
    });
  } catch (error) {
    throw requestError(error);
  }
  return parseHostedOnrampSession(value);
}

export async function requestIdrxMint(options: {
  fetchAccountResource: FundingAccountResource;
  attemptId: string;
  toBeMinted: string;
  rail: IdrxFundingRail;
  channelId?: IdrxVaChannel;
  consent: true;
  signal?: AbortSignal;
}): Promise<IdrxMintResult> {
  let value: unknown;
  try {
    value = await options.fetchAccountResource("/api/funding/idrx-mint", {
      method: "POST",
      body: {
        assetId: "idrx",
        country: IDRX_COUNTRY,
        attemptId: options.attemptId,
        toBeMinted: options.toBeMinted,
        rail: options.rail,
        ...(options.rail === "bank-va" && options.channelId
          ? { channelId: options.channelId }
          : {}),
        consent: options.consent,
      },
      signal: options.signal,
    });
  } catch (error) {
    throw requestError(error);
  }
  return parseIdrxMintResult(value);
}

export function parseHostedOnrampSession(value: unknown): HostedOnrampSession {
  if (!isRecord(value) || !isRecord(value.asset) || !isRecord(value.network)) {
    throw new FundingRequestError("invalid-response");
  }
  const url = parseCoinbaseHostedUrl(value.url);
  if (
    value.asset.id !== "usdc" ||
    value.asset.symbol !== "USDC" ||
    value.asset.decimals !== 6 ||
    value.asset.tokenAddress !== FUNDING_BASE_USDC_ADDRESS ||
    value.network.name !== "Base" ||
    value.network.chainId !== FUNDING_BASE_CHAIN_ID
  ) {
    throw new FundingRequestError("invalid-response");
  }
  return {
    url,
    asset: {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      tokenAddress: FUNDING_BASE_USDC_ADDRESS,
    },
    network: { name: "Base", chainId: FUNDING_BASE_CHAIN_ID },
  };
}

export function parseIdrxMintResult(value: unknown): IdrxMintResult {
  if (
    !isRecord(value) ||
    !isRecord(value.asset) ||
    !isRecord(value.network) ||
    !isRecord(value.verification) ||
    value.asset.id !== "idrx" ||
    value.asset.symbol !== "IDRX" ||
    value.asset.decimals !== IDRX_DECIMALS ||
    typeof value.asset.tokenAddress !== "string" ||
    value.asset.tokenAddress.toLowerCase() !== IDRX_BASE_ADDRESS ||
    value.network.name !== "Base" ||
    value.network.chainId !== FUNDING_BASE_CHAIN_ID ||
    value.verification.status !== "pending" ||
    value.verification.boundary !== "balance-and-activity" ||
    typeof value.merchantOrderId !== "string" ||
    value.merchantOrderId.length === 0
  ) {
    throw new FundingRequestError("invalid-response");
  }
  const asset = {
    id: "idrx" as const,
    symbol: "IDRX" as const,
    decimals: IDRX_DECIMALS,
    tokenAddress: IDRX_BASE_ADDRESS,
  };
  const network = { name: "Base" as const, chainId: FUNDING_BASE_CHAIN_ID };
  const verification = {
    status: "pending" as const,
    boundary: "balance-and-activity" as const,
  };
  if (value.presentation === "hosted" && value.rail === "qris") {
    return {
      presentation: "hosted",
      rail: "qris",
      asset,
      network,
      merchantOrderId: value.merchantOrderId,
      url: parseIdrxCheckoutUrl(value.url),
      verification,
    };
  }
  if (
    value.presentation !== "virtual-account" ||
    value.rail !== "bank-va" ||
    (value.channelId !== "MANDIRI" && value.channelId !== "BRI") ||
    typeof value.virtualAccountNo !== "string" ||
    !/^\d{8,32}$/.test(value.virtualAccountNo) ||
    typeof value.virtualAccountName !== "string" ||
    typeof value.amount !== "string" ||
    typeof value.baseAmount !== "string" ||
    typeof value.expiredDate !== "string" ||
    !Array.isArray(value.fees)
  ) {
    throw new FundingRequestError("invalid-response");
  }
  return {
    presentation: "virtual-account",
    rail: "bank-va",
    asset,
    network,
    merchantOrderId: value.merchantOrderId,
    reference: typeof value.reference === "string" ? value.reference : null,
    virtualAccountNo: value.virtualAccountNo,
    virtualAccountName: value.virtualAccountName,
    amount: value.amount,
    baseAmount: value.baseAmount,
    fees: value.fees.map(parseFee),
    expiredDate: value.expiredDate,
    channelId: value.channelId,
    verification,
  };
}

export function parseCoinbaseHostedUrl(value: unknown): string {
  return parseHostedUrl(value, "pay.coinbase.com", ["/buy", "/buy/select-asset"], "sessionToken");
}

export function parseIdrxCheckoutUrl(value: unknown): string {
  return parseHostedUrl(value, "checkout.idrx.co", ["/", ""], "token");
}

function parseHostedUrl(
  value: unknown,
  hostname: string,
  paths: string[],
  requiredQuery: string,
): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new FundingRequestError("invalid-response");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FundingRequestError("invalid-response");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== hostname ||
    !paths.includes(url.pathname) ||
    !url.searchParams.get(requiredQuery) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new FundingRequestError("invalid-response");
  }
  return url.toString();
}

function parseFee(value: unknown): { name: string; amount: string } {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.amount !== "string") {
    throw new FundingRequestError("invalid-response");
  }
  return { name: value.name, amount: value.amount };
}

function requestError(error: unknown): FundingRequestError {
  const status = readErrorStatus(error);
  return new FundingRequestError(
    status === 401
      ? "unauthenticated"
      : status === 409
        ? "pending"
        : status === 424
        ? "not-configured"
        : "unavailable",
  );
}

function readErrorStatus(error: unknown): number | null {
  return error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
