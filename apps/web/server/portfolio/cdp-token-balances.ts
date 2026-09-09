import { generateJwt } from "@coinbase/cdp-sdk/auth";

export const CDP_TOKEN_BALANCES_HOST = "api.cdp.coinbase.com" as const;
export const CDP_TOKEN_BALANCES_NETWORK = "base" as const;
/** Onchain Data path — not `/platform/v2/evm/token-balances/…`. */
export const CDP_TOKEN_BALANCES_PATH_PREFIX =
  "/platform/v2/data/evm/token-balances" as const;
export const CDP_NATIVE_TOKEN_ADDRESS =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
export const CDP_TOKEN_BALANCES_PAGE_SIZE = 20;
export const CDP_TOKEN_BALANCES_MAX_PAGES = 8;
export const CDP_TOKEN_BALANCES_TIMEOUT_MS = 10_000;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const amountPattern = /^[0-9]+$/;
const pageTokenPattern = /^[A-Za-z0-9._~-]{1,512}$/;

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
  /** False when the page budget ran out while a cursor remained. */
  complete: boolean;
};

export type ListTokenBalancesRequest = {
  address: `0x${string}`;
  /** Stop paging once every lowercase contract (or native sentinel) is seen. */
  neededContractAddresses?: ReadonlySet<string>;
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
} = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateJwtImpl = options.generateJwtImpl ?? generateJwt;
  const timeoutMs = options.timeoutMs ?? CDP_TOKEN_BALANCES_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new CdpTokenBalancesError(
      "not-configured",
      "The CDP Token Balances timeout must be 1-30000ms.",
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
      const collected = new Map<string, ListedTokenBalance>();
      let pageToken: string | undefined;
      let complete = true;

      for (let page = 0; page < CDP_TOKEN_BALANCES_MAX_PAGES; page += 1) {
        const balances = await fetchPage({
          address,
          pageToken,
          env,
          fetchImpl,
          generateJwtImpl,
          timeoutMs,
          signal: request.signal,
        });
        for (const balance of balances.items) {
          if (collected.has(balance.contractAddress)) continue;
          collected.set(balance.contractAddress, balance);
        }
        if (
          request.neededContractAddresses &&
          allowlistSatisfied(request.neededContractAddresses, collected)
        ) {
          complete = true;
          break;
        }
        if (!balances.nextPageToken) {
          complete = true;
          break;
        }
        if (page === CDP_TOKEN_BALANCES_MAX_PAGES - 1) {
          complete = false;
          break;
        }
        pageToken = balances.nextPageToken;
      }

      return { balances: [...collected.values()], complete };
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
  const nextPageToken =
    typeof value.nextPageToken === "string" && pageTokenPattern.test(value.nextPageToken)
      ? value.nextPageToken
      : undefined;
  return { items, nextPageToken };
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
