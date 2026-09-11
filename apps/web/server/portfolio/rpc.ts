import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  NATIVE_ETH_DECIMALS,
  type Address,
  type PortfolioSnapshot,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";

export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
export const PORTFOLIO_RPC_TIMEOUT_MS = 6_000;

const UINT256_MAX =
  (BigInt(1) << BigInt(256)) - BigInt(1);
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

type FetchLike = typeof fetch;
type RpcId = 1 | 2 | 3 | 4 | 5;

type RpcRequest = {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params: unknown[];
};

type RpcResponse = {
  jsonrpc: "2.0";
  id: RpcId;
  result: unknown;
};

type BlockMetadata = {
  numberHex: string;
  numberDecimal: string;
  hash: `0x${string}`;
  timestampDecimal: string;
};

export class PortfolioRpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortfolioRpcError";
  }
}

export type BaseRpcUrlSource = "configured" | "public-default";
export type BaseRpcHostClass = "cdp-node" | "public-base" | "loopback" | "other";

export function describeBaseRpcUrlResolution(
  configuredUrl: string | undefined = process.env.BASE_RPC_URL,
): { source: BaseRpcUrlSource } {
  return { source: configuredUrl?.trim() ? "configured" : "public-default" };
}

export function hostedRuntimeExpectsManagedBaseRpcUrl(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv === "production" || vercelEnv === "preview";
}

export function classifyBaseRpcHost(resolvedUrl: string): BaseRpcHostClass {
  const hostname = parseRpcUrl(resolvedUrl).hostname.toLowerCase();
  if (hostname === "api.developer.coinbase.com") {
    return "cdp-node";
  }
  if (hostname === "mainnet.base.org") {
    return "public-base";
  }
  if (isLoopbackHostname(hostname)) {
    return "loopback";
  }
  return "other";
}

export function inspectBaseRpcUrl(
  configuredUrl: string | undefined = process.env.BASE_RPC_URL,
): {
  source: BaseRpcUrlSource;
  hostClass: BaseRpcHostClass;
  protocol: "https" | "http";
} {
  const resolvedUrl = resolveBaseRpcUrl(configuredUrl);
  return {
    source: describeBaseRpcUrlResolution(configuredUrl).source,
    hostClass: classifyBaseRpcHost(resolvedUrl),
    protocol: new URL(resolvedUrl).protocol === "http:" ? "http" : "https",
  };
}

export function resolveBaseRpcUrl(
  configuredUrl: string | undefined = process.env.BASE_RPC_URL,
): string {
  const rawUrl = configuredUrl?.trim() || DEFAULT_BASE_RPC_URL;
  const url = parseRpcUrl(rawUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PortfolioRpcError("BASE_RPC_URL must use HTTP or HTTPS.");
  }

  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new PortfolioRpcError(
      "Insecure BASE_RPC_URL values are allowed only for loopback development.",
    );
  }

  if (url.username || url.password || url.hash) {
    throw new PortfolioRpcError(
      "BASE_RPC_URL must not contain user info or a URL fragment.",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function createBasePortfolioReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? PORTFOLIO_RPC_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new PortfolioRpcError("The Base RPC timeout must be 1-30000ms.");
  }

  return async function readBasePortfolio(
    account: VerifiedPortfolioAccount,
    externalSignal?: AbortSignal,
  ): Promise<PortfolioSnapshot> {
    assertVerifiedAccount(account);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

    try {
      const chainResponse = await executeRpc(
        fetchImpl,
        rpcUrl,
        request(1, "eth_chainId", []),
        controller.signal,
      );
      const chainId = parseQuantity(chainResponse.result, "chainId", UINT256_MAX);
      if (chainId !== BigInt(BASE_CHAIN_ID)) {
        throw new PortfolioRpcError("The configured RPC is not Base mainnet.");
      }

      const latestBlockResponse = await executeRpc(
        fetchImpl,
        rpcUrl,
        request(2, "eth_getBlockByNumber", ["latest", false]),
        controller.signal,
      );
      const sourceBlock = parseBlock(latestBlockResponse.result);
      const normalizedAddress = account.address.toLowerCase() as Address;

      const balanceResponses = await executeRpcBatch(
        fetchImpl,
        rpcUrl,
        [
          request(3, "eth_getBalance", [normalizedAddress, sourceBlock.numberHex]),
          request(4, "eth_call", [
            {
              to: BASE_USDC_ADDRESS,
              data: encodeBalanceOf(normalizedAddress),
            },
            sourceBlock.numberHex,
          ]),
        ],
        controller.signal,
      );
      const nativeBalance = parseQuantity(
        responseById(balanceResponses, 3).result,
        "native balance",
        UINT256_MAX,
      );
      const usdcBalance = parseDataWord(
        responseById(balanceResponses, 4).result,
        "USDC balance",
      );

      const confirmationResponse = await executeRpc(
        fetchImpl,
        rpcUrl,
        request(5, "eth_getBlockByNumber", [sourceBlock.numberHex, false]),
        controller.signal,
      );
      const confirmedBlock = parseBlock(confirmationResponse.result);
      if (
        confirmedBlock.numberHex !== sourceBlock.numberHex ||
        confirmedBlock.hash.toLowerCase() !== sourceBlock.hash.toLowerCase()
      ) {
        throw new PortfolioRpcError(
          "The Base source block changed while balances were fetched.",
        );
      }

      const fetchedAt = now();
      if (Number.isNaN(fetchedAt.getTime())) {
        throw new PortfolioRpcError("The portfolio fetch time is invalid.");
      }

      return {
        walletAddress: normalizedAddress,
        chainId: BASE_CHAIN_ID,
        blockNumber: sourceBlock.numberDecimal,
        blockHash: sourceBlock.hash.toLowerCase() as `0x${string}`,
        blockTimestamp: sourceBlock.timestampDecimal,
        fetchedAt: fetchedAt.toISOString(),
        assets: [
          {
            id: "usdc",
            symbol: "USDC",
            decimals: BASE_USDC_DECIMALS,
            kind: "erc20",
            tokenAddress: BASE_USDC_ADDRESS,
            balanceBaseUnits: usdcBalance.toString(10),
          },
          {
            id: "eth",
            symbol: "ETH",
            decimals: NATIVE_ETH_DECIMALS,
            kind: "native",
            balanceBaseUnits: nativeBalance.toString(10),
          },
        ],
      };
    } catch (error) {
      if (error instanceof PortfolioRpcError) {
        throw error;
      }
      const message = controller.signal.aborted
        ? "The Base RPC request timed out or was aborted."
        : "The Base RPC request failed.";
      throw new PortfolioRpcError(message, { cause: error });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

export const getBasePortfolio = createBasePortfolioReader();

function request(
  id: RpcId,
  method: string,
  params: unknown[],
): RpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

async function executeRpc(
  fetchImpl: FetchLike,
  rpcUrl: string,
  rpcRequest: RpcRequest,
  signal: AbortSignal,
): Promise<RpcResponse> {
  const parsed = await executeRpcTransport(fetchImpl, rpcUrl, rpcRequest, signal);
  if (Array.isArray(parsed)) {
    throw new PortfolioRpcError("Base RPC returned an unexpected batch response.");
  }
  return parseRpcResponse(parsed, rpcRequest.id);
}

async function executeRpcBatch(
  fetchImpl: FetchLike,
  rpcUrl: string,
  requests: RpcRequest[],
  signal: AbortSignal,
): Promise<RpcResponse[]> {
  if (requests.length === 0 || requests.length > 2) {
    throw new PortfolioRpcError("The Base RPC batch size is invalid.");
  }

  const parsed = await executeRpcTransport(fetchImpl, rpcUrl, requests, signal);
  if (!Array.isArray(parsed) || parsed.length !== requests.length) {
    throw new PortfolioRpcError("Base RPC returned an invalid batch response.");
  }

  const responses = parsed.map((value) => parseRpcResponse(value));
  for (const rpcRequest of requests) {
    if (responses.filter((response) => response.id === rpcRequest.id).length !== 1) {
      throw new PortfolioRpcError("Base RPC returned mismatched batch response IDs.");
    }
  }
  return responses;
}

async function executeRpcTransport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest | RpcRequest[],
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new PortfolioRpcError(
      signal.aborted
        ? "The Base RPC request timed out or was aborted."
        : "The Base RPC transport failed.",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new PortfolioRpcError(`Base RPC returned HTTP ${response.status}.`);
  }

  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new PortfolioRpcError("Base RPC returned malformed JSON.", {
      cause: error,
    });
  }
}

function parseRpcResponse(value: unknown, expectedId?: RpcId): RpcResponse {
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    throw new PortfolioRpcError("Base RPC returned an invalid response envelope.");
  }
  if ("error" in value) {
    throw new PortfolioRpcError("Base RPC returned an RPC error.");
  }
  if (
    typeof value.id !== "number" ||
    !Number.isInteger(value.id) ||
    value.id < 1 ||
    value.id > 5 ||
    !("result" in value)
  ) {
    throw new PortfolioRpcError("Base RPC returned an invalid response envelope.");
  }
  if (expectedId !== undefined && value.id !== expectedId) {
    throw new PortfolioRpcError("Base RPC returned a mismatched response ID.");
  }
  return value as RpcResponse;
}

function responseById(responses: RpcResponse[], id: RpcId): RpcResponse {
  const response = responses.find((candidate) => candidate.id === id);
  if (!response) {
    throw new PortfolioRpcError("Base RPC omitted a required batch response.");
  }
  return response;
}

function parseBlock(value: unknown): BlockMetadata {
  if (!isRecord(value)) {
    throw new PortfolioRpcError("Base RPC returned invalid block metadata.");
  }
  const number = parseQuantity(value.number, "block number", UINT256_MAX);
  const timestamp = parseQuantity(value.timestamp, "block timestamp", UINT256_MAX);
  if (typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) {
    throw new PortfolioRpcError("Base RPC returned an invalid block hash.");
  }
  return {
    numberHex: value.number as string,
    numberDecimal: number.toString(10),
    hash: value.hash as `0x${string}`,
    timestampDecimal: timestamp.toString(10),
  };
}

function parseQuantity(value: unknown, label: string, maximum: bigint): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new PortfolioRpcError(`Base RPC returned malformed ${label} hex.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) {
    throw new PortfolioRpcError(`Base RPC returned an out-of-range ${label}.`);
  }
  return parsed;
}

function parseDataWord(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !dataWordPattern.test(value)) {
    throw new PortfolioRpcError(`Base RPC returned malformed ${label} data.`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) {
    throw new PortfolioRpcError(`Base RPC returned an out-of-range ${label}.`);
  }
  return parsed;
}

function encodeBalanceOf(address: Address): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function assertVerifiedAccount(
  account: VerifiedPortfolioAccount,
): asserts account is VerifiedPortfolioAccount {
  if (
    account.verification !== "session-smart-account" ||
    account.chainId !== BASE_CHAIN_ID ||
    !addressPattern.test(account.address)
  ) {
    throw new PortfolioRpcError(
      "Portfolio reads require a verified Base smart account.",
    );
  }
}

function parseRpcUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch (error) {
    throw new PortfolioRpcError("BASE_RPC_URL must be a valid URL.", {
      cause: error,
    });
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
