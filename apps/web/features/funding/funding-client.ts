import {
  FUNDING_BASE_CHAIN_ID,
  FUNDING_BASE_USDC_ADDRESS,
  type HostedOnrampSession,
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
    value = await options.fetchAccountResource(
      "/api/funding/onramp-session",
      {
        method: "POST",
        body: { assetId: "usdc" },
        signal: options.signal,
      },
    );
  } catch (error) {
    const status = readErrorStatus(error);
    throw new FundingRequestError(
      status === 401
        ? "unauthenticated"
        : status === 424
          ? "not-configured"
          : "unavailable",
    );
  }
  return parseHostedOnrampSession(value);
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

export function parseCoinbaseHostedUrl(value: unknown): string {
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
    url.hostname !== "pay.coinbase.com" ||
    (url.pathname !== "/buy" && url.pathname !== "/buy/select-asset") ||
    !url.searchParams.has("sessionToken") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new FundingRequestError("invalid-response");
  }
  return url.toString();
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
