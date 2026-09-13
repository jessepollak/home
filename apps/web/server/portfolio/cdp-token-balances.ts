import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";

export const CDP_TOKEN_BALANCES_HOST = "api.cdp.coinbase.com" as const;
export const CDP_TOKEN_BALANCES_NETWORK = "base" as const;
/** Onchain Data path — not `/platform/v2/evm/token-balances/…`. */
export const CDP_TOKEN_BALANCES_PATH_PREFIX =
  "/platform/v2/data/evm/token-balances" as const;
export const CDP_NATIVE_TOKEN_ADDRESS =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
export const CDP_TOKEN_BALANCES_PAGE_SIZE = 20;
/** Hard request budget: enough for dusty wallets while preventing unbounded scans. */
export const CDP_TOKEN_BALANCES_MAX_PAGES = 32;
export const CDP_TOKEN_BALANCES_PAGE_ATTEMPTS = 2;
export const CDP_TOKEN_BALANCES_CACHE_TTL_MS = 60_000;
export const CDP_TOKEN_BALANCES_CACHE_MAX_OWNERS = 32;
export const CDP_TOKEN_BALANCES_TIMEOUT_MS = 10_000;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const amountPattern = /^[0-9]+$/;
/** CDP ListResponse example is standard base64, including `=` padding. */
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

  constructor(
    code: CdpTokenBalancesErrorCode,
    message: string,
    options?: ErrorOptions & { status?: number | null },
  ) {
    super(message, options);
    this.name = "CdpTokenBalancesError";
    this.code = code;
    this.status = options?.status ?? null;
  }
}

export type ListedTokenBalance = {
  contractAddress: `0x${string}`;
  amountBaseUnits: string;
  native: boolean;
};

export type TokenBalancesPageSet = {
  balances: ListedTokenBalance[];
  /** False when a page, cursor, request budget, or resumed observation prevented an exhaustive scan. */
  complete: boolean;
  /** Present on resumed scans so older checkpoint quantities stay non-authoritative. */
  authoritativeContractAddresses?: ReadonlySet<string>;
};

type PaginationCheckpoint = {
  balances: Map<string, ListedTokenBalance>;
  nextPageToken: string;
  seenPageTokens: Set<string>;
  savedAt: number;
};

export type ListTokenBalancesRequest = {
  address: `0x${string}`;
  /** Stop paging once every lowercase contract (or native sentinel) is seen. */
  neededContractAddresses?: ReadonlySet<string>;
  /** Ignore and replace the same-owner pagination checkpoint for this read. */
  fresh?: boolean;
  signal?: AbortSignal;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type JwtGenerator = typeof generateJwt;
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
  timeoutMs?: number;
  pageAttempts?: number;
  cacheTtlMs?: number;
  now?: () => number;
} = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateJwtImpl = options.generateJwtImpl ?? generateJwt;
  const timeoutMs = options.timeoutMs ?? CDP_TOKEN_BALANCES_TIMEOUT_MS;
  const pageAttempts = options.pageAttempts ?? CDP_TOKEN_BALANCES_PAGE_ATTEMPTS;
  const cacheTtlMs = options.cacheTtlMs ?? CDP_TOKEN_BALANCES_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const checkpoints = new Map<string, PaginationCheckpoint>();

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances timeout must be 1-30000ms.",
    );
  }
  if (!Number.isSafeInteger(pageAttempts) || pageAttempts <= 0 || pageAttempts > 3) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances page attempt budget must be 1-3.",
    );
  }
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300_000) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances checkpoint TTL must be 0-300000ms.",
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
        );
      }
      const address = request.address.toLowerCase() as `0x${string}`;
      const currentTime = now();
      evictExpiredCheckpoints(checkpoints, currentTime, cacheTtlMs);
      if (request.fresh) checkpoints.delete(address);
      const checkpoint = checkpoints.get(address);
      const resumed = checkpoint !== undefined;
      const observationStartedAt = checkpoint?.savedAt ?? currentTime;
      const collected = new Map(checkpoint?.balances ?? []);
      const authoritativeContractAddresses = new Set<string>();
      const seenPageTokens = new Set(checkpoint?.seenPageTokens ?? []);
      let pageToken = checkpoint?.nextPageToken;
      let complete = false;

      for (let page = 0; page < CDP_TOKEN_BALANCES_MAX_PAGES; page += 1) {
        let balances: Awaited<ReturnType<typeof fetchPage>>;
        try {
          balances = await fetchPageWithRetry({
            attempts: pageAttempts,
            address,
            pageToken,
            env,
            fetchImpl,
            generateJwtImpl,
            timeoutMs,
            signal: request.signal,
          });
        } catch (error) {
          // A missing later page must not erase quantities already read. Save
          // the exact cursor so the same owner can resume on the next refresh.
          if (collected.size > 0 && pageToken && isTransientPageError(error)) {
            saveCheckpoint(checkpoints, address, {
              balances: collected,
              nextPageToken: pageToken,
              seenPageTokens,
              savedAt: observationStartedAt,
            });
            break;
          }
          throw error;
        }
        for (const balance of balances.items) {
          collected.set(balance.contractAddress, balance);
          authoritativeContractAddresses.add(balance.contractAddress);
        }
        if (
          request.neededContractAddresses &&
          allowlistSatisfied(request.neededContractAddresses, collected)
        ) {
          complete = !resumed;
          checkpoints.delete(address);
          break;
        }
        if (!balances.nextPageToken) {
          complete = !resumed;
          checkpoints.delete(address);
          break;
        }
        if (
          balances.nextPageToken === pageToken ||
          seenPageTokens.has(balances.nextPageToken)
        ) {
          saveCheckpoint(checkpoints, address, {
            balances: collected,
            nextPageToken: balances.nextPageToken,
            seenPageTokens,
            savedAt: observationStartedAt,
          });
          break;
        }
        seenPageTokens.add(balances.nextPageToken);
        pageToken = balances.nextPageToken;
        if (page === CDP_TOKEN_BALANCES_MAX_PAGES - 1) {
          saveCheckpoint(checkpoints, address, {
            balances: collected,
            nextPageToken: pageToken,
            seenPageTokens,
            savedAt: observationStartedAt,
          });
        }
      }

      return {
        balances: [...collected.values()],
        complete,
        ...(resumed ? { authoritativeContractAddresses } : {}),
      };
    },
  };
}

export type CdpTokenBalancesClient = ReturnType<
  typeof createCdpTokenBalancesClient
>;

function allowlistSatisfied(
  needed: ReadonlySet<string>,
  collected: ReadonlyMap<string, ListedTokenBalance>,
): boolean {
  for (const address of needed) {
    if (!collected.has(address.toLowerCase())) return false;
  }
  return true;
}

async function fetchPageWithRetry(
  options: Parameters<typeof fetchPage>[0] & { attempts: number },
): Promise<Awaited<ReturnType<typeof fetchPage>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
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

function evictExpiredCheckpoints(
  checkpoints: Map<string, PaginationCheckpoint>,
  currentTime: number,
  ttlMs: number,
): void {
  for (const [address, checkpoint] of checkpoints) {
    if (ttlMs === 0 || currentTime - checkpoint.savedAt > ttlMs) {
      checkpoints.delete(address);
    }
  }
}

function saveCheckpoint(
  checkpoints: Map<string, PaginationCheckpoint>,
  address: string,
  checkpoint: PaginationCheckpoint,
): void {
  checkpoints.delete(address);
  checkpoints.set(address, {
    balances: new Map(checkpoint.balances),
    nextPageToken: checkpoint.nextPageToken,
    seenPageTokens: new Set(checkpoint.seenPageTokens),
    savedAt: checkpoint.savedAt,
  });
  while (checkpoints.size > CDP_TOKEN_BALANCES_CACHE_MAX_OWNERS) {
    const oldest = checkpoints.keys().next().value;
    if (typeof oldest !== "string") break;
    checkpoints.delete(oldest);
  }
}

async function fetchPage(options: {
  address: `0x${string}`;
  pageToken: string | undefined;
  env: Environment;
  fetchImpl: FetchLike;
  generateJwtImpl: JwtGenerator;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  items: ListedTokenBalance[];
  nextPageToken: string | undefined;
}> {
  throwIfAborted(options.signal);
  const apiKeyId = options.env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = options.env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for Token Balances.",
    );
  }

  let jwt: string;
  try {
    jwt = await options.generateJwtImpl({
      apiKeyId,
      apiKeySecret,
      requestMethod: "GET",
      requestHost: CDP_TOKEN_BALANCES_HOST,
      requestPath: tokenBalancesRequestPath(options.address),
      expiresIn: 120,
    });
  } catch (error) {
    throwIfAborted(options.signal);
    throw new CdpTokenBalancesError(
      "not-configured",
      "CDP Token Balances bearer token generation failed.",
      { cause: error },
    );
  }
  if (typeof jwt !== "string" || jwt.trim().length === 0 || /\s/.test(jwt)) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "CDP Token Balances bearer token is malformed.",
    );
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("token-balances-timeout"), options.timeoutMs);

  try {
    const response = await options.fetchImpl(
      tokenBalancesRequestUrl(options.address, options.pageToken),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${jwt}`,
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (response.status === 404) {
      return { items: [], nextPageToken: undefined };
    }
    if (!response.ok) throw responseError(response);
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text()) as unknown;
    } catch (error) {
      throw new CdpTokenBalancesError(
        "invalid-response",
        "CDP Token Balances returned malformed JSON.",
        { cause: error, status: response.status },
      );
    }
    return parsePage(payload);
  } catch (error) {
    if (error instanceof CdpTokenBalancesError) throw error;
    if (controller.signal.aborted) {
      throw new CdpTokenBalancesError(
        "timed-out",
        "CDP Token Balances request timed out or was aborted.",
        { cause: error },
      );
    }
    throw new CdpTokenBalancesError(
      "upstream-error",
      "CDP Token Balances request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
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
    );
  }
  let amount: bigint;
  try {
    amount = BigInt(value.amount.amount);
  } catch {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned a malformed token amount.",
    );
  }
  if (amount < BigInt(0) || amount > UINT256_MAX) {
    throw new CdpTokenBalancesError(
      "invalid-response",
      "CDP Token Balances returned an out-of-range token amount.",
    );
  }
  return {
    contractAddress,
    amountBaseUnits: amount.toString(10),
    native: contractAddress === CDP_NATIVE_TOKEN_ADDRESS,
  };
}

function responseError(response: Response): CdpTokenBalancesError {
  const status = response.status;
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
      { status },
    );
  }
  return new CdpTokenBalancesError(
    "upstream-error",
    "CDP Token Balances request failed.",
    { status },
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new CdpTokenBalancesError(
      "timed-out",
      "CDP Token Balances request was canceled.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
