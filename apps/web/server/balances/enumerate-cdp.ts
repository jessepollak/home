import "server-only";

import { CdpAuthError, signCdpRequest, type CdpJwtGenerator } from "@/server/cdp/auth";
import { readCdpCredentials, serverEnvironment } from "@/server/config/env";

import { createUpstreamDeadline, upstreamRequest, type UpstreamDeadline } from "@/server/http/upstream";
import type { PortfolioBalanceSourceDetail } from "@/server/observability/schema";

export const CDP_TOKEN_BALANCES_HOST = "api.cdp.coinbase.com" as const;
export const CDP_TOKEN_BALANCES_NETWORK = "base" as const;
export const CDP_TOKEN_BALANCES_PATH_PREFIX =
  "/platform/v2/data/evm/token-balances" as const;
export const CDP_NATIVE_TOKEN_ADDRESS =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
export const CDP_TOKEN_BALANCES_PAGE_SIZE = 100;
export const CDP_TOKEN_BALANCES_MAX_PAGES = 32;
export const CDP_TOKEN_BALANCES_PAGE_ATTEMPTS = 2;
export const CDP_TOKEN_BALANCES_SOFT_PAGE_START_MS = 2_500;
export const CDP_TOKEN_BALANCES_INVENTORY_DEADLINE_MS = 4_000;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const amountPattern = /^[0-9]+$/;
const pageTokenPattern = /^[A-Za-z0-9._~+/=-]{1,2048}$/;

export type CdpTokenBalancesErrorCode =
  | "not-configured"
  | "unauthorized"
  | "rate-limited"
  | "timed-out"
  | "upstream-error"
  | "invalid-response";

export class CdpTokenBalancesError extends Error {
  readonly code: CdpTokenBalancesErrorCode;
  readonly status: number | null;
  readonly detail?: PortfolioBalanceSourceDetail;
  pagesRead: number;

  constructor(
    code: CdpTokenBalancesErrorCode,
    message: string,
    options?: ErrorOptions & { status?: number | null; detail?: PortfolioBalanceSourceDetail; pagesRead?: number },
  ) {
    super(message, options);
    this.name = "CdpTokenBalancesError";
    this.code = code;
    this.status = options?.status ?? null;
    this.detail = options?.detail;
    this.pagesRead = options?.pagesRead ?? 0;
  }
}

export type ListedTokenBalance = {
  contractAddress: `0x${string}`;
  amountBaseUnits: string;
  name?: string;
  symbol?: string;
  decimals?: number;
};

export type TokenBalancesPageSet = {
  balances: ListedTokenBalance[];
  complete: boolean;
  nextPageToken: string | null;
  pagesRead: number;
  durationMs: number;
  interruption?: CdpTokenBalancesErrorCode;
  detail?: PortfolioBalanceSourceDetail;
};

export type ListTokenBalancesRequest = {
  address: `0x${string}`;
  pageToken?: string;
  signal?: AbortSignal;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type JwtGenerator = CdpJwtGenerator;
type Environment = Readonly<Record<string, string | undefined>>;

export function tokenBalancesRequestPath(address: `0x${string}`): string {
  return `${CDP_TOKEN_BALANCES_PATH_PREFIX}/${CDP_TOKEN_BALANCES_NETWORK}/${address.toLowerCase()}`;
}

export function tokenBalancesRequestUrl(
  address: `0x${string}`,
  pageToken?: string,
): string {
  const url = new URL(
    `https://${CDP_TOKEN_BALANCES_HOST}${tokenBalancesRequestPath(address)}`,
  );
  url.searchParams.set("pageSize", String(CDP_TOKEN_BALANCES_PAGE_SIZE));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

export function createCdpTokenBalancesClient(options: {
  env?: Environment;
  fetchImpl?: FetchLike;
  generateJwtImpl?: JwtGenerator;
  deadlineMs?: number;
  pageAttempts?: number;
  pageStartBudgetMs?: number;
  clock?: Parameters<typeof createUpstreamDeadline>[0]["clock"];
} = {}) {
  const env = options.env ?? serverEnvironment();
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateJwtImpl = options.generateJwtImpl;
  const deadlineMs = options.deadlineMs ?? CDP_TOKEN_BALANCES_INVENTORY_DEADLINE_MS;
  const pageAttempts = options.pageAttempts ?? CDP_TOKEN_BALANCES_PAGE_ATTEMPTS;
  const pageStartBudgetMs = options.pageStartBudgetMs ?? CDP_TOKEN_BALANCES_SOFT_PAGE_START_MS;
  const clock = options.clock;

  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 30_000) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances inventory deadline must be 1-30000ms.",
    );
  }
  if (!Number.isSafeInteger(pageAttempts) || pageAttempts <= 0 || pageAttempts > 3) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances page attempt budget must be 1-3.",
    );
  }
  if (!Number.isSafeInteger(pageStartBudgetMs) || pageStartBudgetMs <= 0 || pageStartBudgetMs > 30_000) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances page-start budget must be 1-30000ms.",
    );
  }
  if (pageStartBudgetMs > deadlineMs) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances page-start budget must not exceed the inventory deadline.",
    );
  }
  return {
    async listBalances(
      request: ListTokenBalancesRequest,
    ): Promise<TokenBalancesPageSet> {
      if (!addressPattern.test(request.address)) {
        throw new CdpTokenBalancesError(
          "invalid-response",
          "Token Balances requires a verified 0x address.",
          { detail: "invalid-address" },
        );
      }
      const address = request.address.toLowerCase() as `0x${string}`;
      const collected = new Map<string, ListedTokenBalance>();
      const seenPageTokens = new Set<string>();
      let pageToken = request.pageToken;
      let nextPageToken: string | null = pageToken ?? null;
      let complete = false;
      let pagesRead = 0;
      let interruption: CdpTokenBalancesErrorCode | undefined;
      let detail: PortfolioBalanceSourceDetail | undefined;
      const deadline = createUpstreamDeadline({ timeoutMs: deadlineMs, signal: request.signal, clock });
      const startedAt = deadline.now();

      for (let page = 0; page < CDP_TOKEN_BALANCES_MAX_PAGES; page += 1) {
        if (page > 0 && deadline.now() - startedAt >= pageStartBudgetMs) break;
        let balances: Awaited<ReturnType<typeof fetchPage>>;
        try {
          balances = await fetchPageWithinCeiling({
            attempts: pageAttempts,
            address,
            pageToken,
            env,
            fetchImpl,
            generateJwtImpl,
            deadline,
          });
        } catch (error) {
          if (collected.size > 0 && pageToken && isTransientPageError(error)) {
            if (error instanceof CdpTokenBalancesError) {
              interruption = error.code;
              detail = error.detail;
            }
            break;
          }
          if (error instanceof CdpTokenBalancesError) error.pagesRead = pagesRead;
          throw error;
        }
        pagesRead += 1;
        for (const balance of balances.items) {
          collected.set(balance.contractAddress, balance);
        }
        if (!balances.nextPageToken) {
          complete = true;
          nextPageToken = null;
          break;
        }
        nextPageToken = balances.nextPageToken;
        if (
          balances.nextPageToken === pageToken ||
          seenPageTokens.has(balances.nextPageToken)
        ) {
          break;
        }
        seenPageTokens.add(balances.nextPageToken);
        pageToken = balances.nextPageToken;
      }

      return {
        balances: [...collected.values()],
        complete,
        nextPageToken,
        pagesRead,
        durationMs: Math.max(0, deadline.now() - startedAt),
        ...(interruption === undefined ? {} : { interruption }),
        ...(detail === undefined ? {} : { detail }),
      };
    },
  };
}

export type CdpTokenBalancesClient = ReturnType<
  typeof createCdpTokenBalancesClient
>;

async function fetchPageWithinCeiling(
  options: Parameters<typeof fetchPage>[0] & { attempts: number },
): Promise<Awaited<ReturnType<typeof fetchPage>>> {
  const { signal } = options.deadline;
  throwIfAborted(options.deadline);
  const aborted = Promise.withResolvers<never>();
  const onCeilingAbort = () => aborted.reject(new CdpTokenBalancesError(
    "timed-out",
    "CDP Token Balances request timed out or was aborted.",
    { cause: signal.reason, detail: interruptionDetail(options.deadline) },
  ));
  signal.addEventListener("abort", onCeilingAbort, { once: true });
  if (signal.aborted) onCeilingAbort();
  try {
    const inner = fetchPageWithRetry(options);
    return await Promise.race([inner, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onCeilingAbort);
  }
}

async function fetchPageWithRetry(
  options: Parameters<typeof fetchPageWithinCeiling>[0],
): Promise<Awaited<ReturnType<typeof fetchPage>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      if (options.deadline.remainingMs() <= 0) {
        throw new CdpTokenBalancesError(
          "timed-out",
          "CDP Token Balances inventory deadline was reached.",
          { detail: interruptionDetail(options.deadline) },
        );
      }
      return await fetchPage(options);
    } catch (error) {
      lastError = error;
      if (!isTransientPageError(error) || attempt === options.attempts - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isTransientPageError(error: unknown): boolean {
  return (
    error instanceof CdpTokenBalancesError &&
    (error.code === "rate-limited" ||
      error.code === "timed-out" ||
      error.code === "upstream-error")
  );
}

async function fetchPage(options: {
  address: `0x${string}`;
  pageToken: string | undefined;
  env: Environment;
  fetchImpl: FetchLike;
  generateJwtImpl: JwtGenerator | undefined;
  deadline: UpstreamDeadline;
}): Promise<{
  items: ListedTokenBalance[];
  nextPageToken: string | undefined;
}> {
  const { signal } = options.deadline;
  throwIfAborted(options.deadline);
  if (readCdpCredentials(options.env).status !== "complete") {
    throw new CdpTokenBalancesError(
      "not-configured",
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for Token Balances.",
    );
  }

  let authorization: string;
  try {
    ({ authorization } = await signCdpRequest({
      env: options.env,
      generateJwtImpl: options.generateJwtImpl,
      method: "GET",
      host: CDP_TOKEN_BALANCES_HOST,
      path: tokenBalancesRequestPath(options.address),
    }));
  } catch (error) {
    if (error instanceof CdpAuthError && error.code === "malformed-token") {
      throw new CdpTokenBalancesError(
        "not-configured",
        "CDP Token Balances bearer token is malformed.",
      );
    }
    throwIfAborted(options.deadline);
    throw new CdpTokenBalancesError(
      "not-configured",
      "CDP Token Balances bearer token generation failed.",
      { cause: error },
    );
  }

  throwIfAborted(options.deadline);
  if (options.deadline.remainingMs() <= 0) {
    throw new CdpTokenBalancesError(
      "timed-out",
      "CDP Token Balances inventory deadline was reached.",
      { detail: interruptionDetail(options.deadline) },
    );
  }
  try {
    const result = await upstreamRequest(
      tokenBalancesRequestUrl(options.address, options.pageToken),
      {
        deadline: options.deadline,
        maxBytes: 1024 * 1024,
        responseType: "json",
        fetchImpl: options.fetchImpl,
        init: {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization,
          },
          cache: "no-store",
        },
      },
    );
    if (result.ok) return parsePage(result.value);
    switch (result.kind) {
      case "http":
        if (result.status === 404) return { items: [], nextPageToken: undefined };
        throw responseError(result.status);
      case "timeout":
      case "aborted":
        throw new CdpTokenBalancesError(
          "timed-out",
          "CDP Token Balances request timed out or was aborted.",
          { detail: interruptionDetail(options.deadline) },
        );
      case "invalid":
        throw new CdpTokenBalancesError(
          "invalid-response",
          "CDP Token Balances returned malformed JSON.",
          { detail: "malformed-json" },
        );
      case "oversized":
        throw new CdpTokenBalancesError(
          "invalid-response",
          "CDP Token Balances response body exceeded the size limit.",
          { detail: "oversized-body" },
        );
      case "transport":
        throw new CdpTokenBalancesError(
          "upstream-error",
          "CDP Token Balances request failed.",
          { cause: result.cause },
        );
    }
  } catch (error) {
    if (error instanceof CdpTokenBalancesError) throw error;
    if (signal.aborted) {
      throw new CdpTokenBalancesError(
        "timed-out",
        "CDP Token Balances request timed out or was aborted.",
        { cause: error, detail: interruptionDetail(options.deadline) },
      );
    }
    throw new CdpTokenBalancesError(
      "upstream-error",
      "CDP Token Balances request failed.",
      { cause: error },
    );
  }
}

function parsePage(value: unknown): {
  items: ListedTokenBalance[];
  nextPageToken: string | undefined;
} {
  if (!isRecord(value) || !Array.isArray(value.balances)) {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned an invalid response envelope.",
      { detail: "invalid-envelope" },
    );
  }
  const items: ListedTokenBalance[] = [];
  const seen = new Set<string>();
  for (const entry of value.balances) {
    const parsed = parseBalance(entry);
    if (parsed === null) continue;
    if (seen.has(parsed.contractAddress)) continue;
    seen.add(parsed.contractAddress);
    items.push(parsed);
  }
  const nextPageToken = parseNextPageToken(value.nextPageToken);
  return { items, nextPageToken };
}

export function parseNextPageToken(value: unknown): string | undefined {
  return typeof value === "string" && pageTokenPattern.test(value) ? value : undefined;
}

function parseBalance(value: unknown): ListedTokenBalance | null {
  if (!isRecord(value) || !isRecord(value.amount) || !isRecord(value.token)) {
    return null;
  }
  if (value.token.network !== CDP_TOKEN_BALANCES_NETWORK) return null;
  if (
    typeof value.token.contractAddress !== "string" ||
    !addressPattern.test(value.token.contractAddress)
  ) {
    return null;
  }
  const contractAddress = value.token.contractAddress.toLowerCase() as `0x${string}`;
  if (typeof value.amount.amount !== "string" || !amountPattern.test(value.amount.amount)) {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned a malformed token amount.",
      { detail: "malformed-amount" },
    );
  }
  let amount: bigint;
  try {
    amount = BigInt(value.amount.amount);
  } catch {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned a malformed token amount.",
      { detail: "malformed-amount" },
    );
  }
  if (amount < BigInt(0) || amount > UINT256_MAX) {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned an out-of-range token amount.",
      { detail: "amount-out-of-range" },
    );
  }
  const name = readBoundedText(value.token.name);
  const symbol = readBoundedText(value.token.symbol);
  const decimals = readDecimals(value.amount.decimals);
  if (contractAddress === CDP_NATIVE_TOKEN_ADDRESS) return null;
  return {
    contractAddress,
    amountBaseUnits: amount.toString(10),
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(decimals !== undefined ? { decimals } : {}),
  };
}

function readBoundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : undefined;
}

function readDecimals(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255
    ? value
    : undefined;
}

function responseError(status: number): CdpTokenBalancesError {
  if (status === 401 || status === 403) {
    return new CdpTokenBalancesError(
      "unauthorized",
      "CDP Token Balances authentication was rejected.",
      { status },
    );
  }
  if (status === 429) {
    return new CdpTokenBalancesError(
      "rate-limited",
      "CDP Token Balances rate limit was reached.",
      { status },
    );
  }
  if (status === 408 || status === 504) {
    return new CdpTokenBalancesError(
      "timed-out",
      "CDP Token Balances request timed out.",
      { status, detail: "upstream-status" },
    );
  }
  return new CdpTokenBalancesError(
    "upstream-error",
    "CDP Token Balances request failed.",
    { status },
  );
}

function interruptionDetail(deadline: UpstreamDeadline): PortfolioBalanceSourceDetail {
  return deadline.interruptionKind() === "timeout" ? "page-ceiling" : "request-aborted";
}

function throwIfAborted(deadline: UpstreamDeadline): void {
  if (deadline.signal.aborted) {
    throw new CdpTokenBalancesError(
      "timed-out",
      "CDP Token Balances request was canceled.",
      { detail: interruptionDetail(deadline) },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
