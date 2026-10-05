import "server-only";

import { readBaseRpcUrl, readEthereumRpcUrl, readVercelEnvironment } from "@/server/config/env";

import { BASE_CHAIN_ID } from "@/shared/assets/base";
import { createUpstreamDeadline, upstreamRequest } from "@/server/http/upstream";

export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
export const DEFAULT_ETHEREUM_RPC_URL = "https://ethereum.reth.rs/rpc";
export const BASE_RPC_TIMEOUT_MS = 6_000;
export const BASE_RPC_MAX_RESPONSE_BYTES = 4_000_000;
export const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
let nextRequestId = 1;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type BaseRpcCall = { method: string; params: readonly unknown[]; id?: number };
export type BaseRpcOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  rpcUrl?: string;
  fetchImpl?: FetchLike;
  id?: number;
};
export type BaseRpcBatchOptions = BaseRpcOptions & { allowPartial?: boolean };

type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: readonly unknown[];
};

type RpcSuccess = { id: number; result: unknown };

export class BaseRpcError extends Error {
  readonly code: "aborted" | "http" | "invalid-response" | "rpc" | "transport";
  readonly rpcCode: number | null;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    options: ErrorOptions & {
      code?: BaseRpcError["code"];
      rpcCode?: number | null;
      httpStatus?: number | null;
    } = {},
  ) {
    super(message, options);
    this.name = "BaseRpcError";
    this.code = options.code ?? "invalid-response";
    this.rpcCode = options.rpcCode ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }
}

export function isBaseRpcCallRevert(error: unknown): boolean {
  return error instanceof BaseRpcError && error.code === "rpc" &&
    (error.rpcCode === 3 || /execution reverted/i.test(error.message));
}

export type BaseRpcUrlSource = "configured" | "public-default";
export type BaseRpcHostClass = "cdp-node" | "public-base" | "loopback" | "other";

export function describeBaseRpcUrlResolution(
  configuredUrl: string | undefined = readBaseRpcUrl(),
): { source: BaseRpcUrlSource } {
  return { source: configuredUrl?.trim() ? "configured" : "public-default" };
}

export function hostedRuntimeExpectsManagedBaseRpcUrl(
  vercelEnv: string | undefined = readVercelEnvironment(),
): boolean {
  return vercelEnv === "production" || vercelEnv === "preview";
}

export function classifyBaseRpcHost(resolvedUrl: string): BaseRpcHostClass {
  const hostname = parseRpcUrl(resolvedUrl).hostname.toLowerCase();
  if (hostname === "api.developer.coinbase.com") return "cdp-node";
  if (hostname === "mainnet.base.org") return "public-base";
  if (isLoopbackHostname(hostname)) return "loopback";
  return "other";
}

export function inspectBaseRpcUrl(
  configuredUrl: string | undefined = readBaseRpcUrl(),
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
  configuredUrl: string | undefined = readBaseRpcUrl(),
): string {
  return resolveRpcUrl(configuredUrl, DEFAULT_BASE_RPC_URL, "BASE_RPC_URL");
}

export function resolveEthereumRpcUrl(
  configuredUrl: string | undefined = readEthereumRpcUrl(),
): string {
  return resolveRpcUrl(configuredUrl, DEFAULT_ETHEREUM_RPC_URL, "ETHEREUM_RPC_URL");
}

export async function baseRpc(
  method: string,
  params: readonly unknown[],
  options: BaseRpcOptions = {},
): Promise<unknown> {
  const id = options.id ?? allocateId();
  assertRequestId(id);
  const payload = await postRpc(request(id, method, params), options);
  if (Array.isArray(payload)) {
    throw new BaseRpcError("Base RPC returned an unexpected batch response.");
  }
  return parseEnvelope(payload, id).result;
}

export async function baseRpcBatch(
  calls: readonly BaseRpcCall[],
  options: BaseRpcBatchOptions = {},
): Promise<Array<unknown | null>> {
  if (calls.length === 0) return [];
  const requests = calls.map((call) => {
    const id = call.id ?? allocateId();
    assertRequestId(id);
    return request(id, call.method, call.params);
  });
  if (new Set(requests.map(({ id }) => id)).size !== requests.length) {
    throw new BaseRpcError("Base RPC batch request IDs must be unique.");
  }
  const payload = await postRpc(requests, options);
  if (!Array.isArray(payload)) {
    throw new BaseRpcError("Base RPC returned an invalid batch response.");
  }
  const requestedIds = new Set(requests.map(({ id }) => id));
  const results = new Map<number, unknown>();
  const invalidIds = new Set<number>();
  for (const value of payload) {
    try {
      const response = parseEnvelope(value);
      if (!requestedIds.has(response.id) || results.has(response.id)) {
        invalidIds.add(response.id);
        results.delete(response.id);
      } else if (!invalidIds.has(response.id)) {
        results.set(response.id, response.result);
      }
    } catch (error) { // oxlint-disable-line home/no-silent-catch -- partial batches intentionally degrade an unreadable envelope to a null result; strict batches rethrow
      if (!options.allowPartial) throw error;
    }
  }
  return requests.map(({ id }) => {
    if (!invalidIds.has(id) && results.has(id)) return results.get(id)!;
    if (options.allowPartial) return null;
    throw new BaseRpcError("Base RPC returned mismatched batch response IDs.");
  });
}

export function createBaseRpcClient(options: Omit<BaseRpcOptions, "id" | "signal"> = {}) {
  return {
    request(method: string, params: readonly unknown[], signal?: AbortSignal, id?: number) {
      return baseRpc(method, params, { ...options, signal, id });
    },
    batch(calls: readonly BaseRpcCall[], signal?: AbortSignal, allowPartial = false) {
      return baseRpcBatch(calls, { ...options, signal, allowPartial });
    },
    async assertBaseChain(signal?: AbortSignal) {
      const chainId = parseRpcQuantity(
        await baseRpc("eth_chainId", [], { ...options, signal }),
        "chain ID",
      );
      if (chainId !== BigInt(BASE_CHAIN_ID)) {
        throw new BaseRpcError("The configured RPC is not Base mainnet.");
      }
    },
  };
}

export function parseRpcQuantity(
  value: unknown,
  label: string,
  maximum: bigint = UINT256_MAX,
): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new BaseRpcError(`Base RPC returned malformed ${label}.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) {
    throw new BaseRpcError(`Base RPC returned out-of-range ${label}.`);
  }
  return parsed;
}

export function parseRpcDataWord(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !dataWordPattern.test(value)) {
    throw new BaseRpcError(`Base RPC returned malformed ${label} data.`);
  }
  return BigInt(value);
}

async function postRpc(
  body: RpcRequest | readonly RpcRequest[],
  options: BaseRpcOptions,
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? BASE_RPC_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new BaseRpcError("The Base RPC timeout must be 1-30000ms.");
  }
  const deadline = createUpstreamDeadline({ timeoutMs, signal: options.signal });
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch (error) {
    throw new BaseRpcError("The Base RPC transport failed.", { code: "transport", cause: error });
  }
  const result = await upstreamRequest(resolveBaseRpcUrl(options.rpcUrl), {
    deadline,
    maxBytes: BASE_RPC_MAX_RESPONSE_BYTES,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: serialized,
    },
    fetchImpl: options.fetchImpl ?? fetch,
  });
  if (result.ok) return result.value;
  if (result.kind === "http") {
    throw new BaseRpcError(`Base RPC returned HTTP ${result.status}.`, {
      code: "http",
      httpStatus: result.status,
    });
  }
  if (result.kind === "oversized") {
    throw new BaseRpcError("Base RPC returned an oversized response.", { code: "invalid-response" });
  }
  if (result.kind === "invalid") {
    throw new BaseRpcError("Base RPC returned malformed JSON.", {
      code: "invalid-response",
      cause: result.cause,
    });
  }
  const cause = result.cause;
  throw new BaseRpcError(
    result.kind === "transport"
      ? "The Base RPC transport failed."
      : "The Base RPC request timed out or was aborted.",
    {
      code: result.kind === "transport" ? "transport" : "aborted",
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

function parseEnvelope(value: unknown, expectedId?: number): RpcSuccess {
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    throw new BaseRpcError("Base RPC returned an invalid response envelope.");
  }
  if ("error" in value) {
    const error = isRecord(value.error) ? value.error : null;
    throw new BaseRpcError(rpcErrorMessage(error), {
      code: "rpc",
      rpcCode: typeof error?.code === "number" ? error.code : null,
    });
  }
  const id = parseResponseId(value.id);
  if (id === null || (expectedId !== undefined && id !== expectedId)) {
    throw new BaseRpcError("Base RPC returned a mismatched response ID.");
  }
  if (!("result" in value)) {
    throw new BaseRpcError("Base RPC returned an invalid response envelope.");
  }
  return { id, result: value.result };
}

function request(id: number, method: string, params: readonly unknown[]): RpcRequest {
  if (!method.trim()) throw new BaseRpcError("The Base RPC method is invalid.");
  return { jsonrpc: "2.0", id, method, params };
}

function allocateId(): number {
  const id = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextRequestId + 1;
  return id;
}

function assertRequestId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BaseRpcError("The Base RPC request ID is invalid.");
  }
}

function parseResponseId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^(?:[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function rpcErrorMessage(error: Record<string, unknown> | null): string {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return message
    ? `Base RPC rejected the request: ${message.slice(0, 160)}`
    : "Base RPC rejected the request.";
}

function resolveRpcUrl(
  configuredUrl: string | undefined,
  fallbackUrl: string,
  variableName: "BASE_RPC_URL" | "ETHEREUM_RPC_URL",
): string {
  const rawUrl = configuredUrl?.trim() || fallbackUrl;
  const url = parseRpcUrl(rawUrl, variableName);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BaseRpcError(`${variableName} must use HTTP or HTTPS.`);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new BaseRpcError(
      `Insecure ${variableName} values are allowed only for loopback development.`,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new BaseRpcError(
      `${variableName} must not contain user info or a URL fragment.`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

function parseRpcUrl(rawUrl: string, variableName = "BASE_RPC_URL"): URL {
  try {
    return new URL(rawUrl);
  } catch (error) {
    throw new BaseRpcError(`${variableName} must be a valid URL.`, { cause: error });
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
