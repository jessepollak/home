import "server-only";

import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import type { ActionRow } from "./store";
import { createUserOperationLogLookup, type UserOperationLogResolution } from "./user-operation-log";

export type HandleResolution =
  | { status: "complete"; transactionHash: `0x${string}`; code?: "USEROP_LOG_V06" | "USEROP_LOG_V07" | "USEROP_LOG_V08" | "BASE_USEROP_LOG_V06" | "BASE_USEROP_LOG_V07" | "BASE_USEROP_LOG_V08" }
  | { status: "pending" }
  | { status: "reverted"; transactionHash?: `0x${string}` }
  | { status: "not_submitted" }
  | { status: "unavailable" };

export type ActionHandleResolver = (
  row: ActionRow,
  signal?: AbortSignal,
) => Promise<HandleResolution>;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_STATUS_RPC_URL = "https://rpc.wallet.coinbase.com";
const DEFAULT_TIMEOUT_MS = 2_500;
const CIRCUIT_BREAKER_MS = 60_000;
const UNKNOWN_HANDLE_BACKOFF_MS = 5 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 30_000;
const MAX_HANDLE_BACKOFFS = 500;
const handlePattern = /^[\x21-\x7e]{1,512}$/;
const transactionHashPattern = /^0x[0-9a-f]{64}$/i;
const unknownHandleCodes = new Set([-32602, 4200, 5730]);

export function createActionHandleResolver(
  options: {
    fetchImpl?: FetchLike;
    walletRpcUrl?: string;
    timeoutMs?: number;
    now?: () => number;
    logLookup?: (row: ActionRow, signal?: AbortSignal) => Promise<UserOperationLogResolution>;
    rpcUrl?: string;
  } = {},
): ActionHandleResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logLookup = options.logLookup ?? createUserOperationLogLookup({ fetchImpl, rpcUrl: options.rpcUrl, now: options.now });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new Error("The Base Account status timeout must be 1-10000ms.");
  }
  const configuredUrl = (options.walletRpcUrl ?? process.env.BASE_ACCOUNT_STATUS_RPC_URL)?.trim() || DEFAULT_STATUS_RPC_URL;
  let rpcUrl: string | null = null;
  const now = options.now ?? Date.now;
  let circuitOpenUntil = 0;
  const handleBackoffs = new Map<string, number>();

  function backoff(handle: string, until: number): void {
    handleBackoffs.delete(handle);
    handleBackoffs.set(handle, until);
    while (handleBackoffs.size > MAX_HANDLE_BACKOFFS) {
      const oldest = handleBackoffs.keys().next().value;
      if (typeof oldest !== "string") break;
      handleBackoffs.delete(oldest);
    }
  }

  return async function resolveActionHandle(
    row: ActionRow,
    externalSignal?: AbortSignal,
  ): Promise<HandleResolution> {
    try {
      if (row.provider === "cdp-embedded") return await logLookup(row, externalSignal);
      if (
        row.provider !== "base-account" ||
        row.provider_handle === null ||
        row.provider_handle === row.id ||
        !handlePattern.test(row.provider_handle)
      ) {
        return { status: "unavailable" };
      }

      const handle = row.provider_handle;
      rpcUrl ??= resolveBaseRpcUrl(configuredUrl);
      const currentTime = now();
      if (currentTime < circuitOpenUntil) return await fallback(row, externalSignal);
      const handleBackoffUntil = handleBackoffs.get(handle) ?? 0;
      if (currentTime < handleBackoffUntil) return await fallback(row, externalSignal);
      if (handleBackoffUntil) handleBackoffs.delete(handle);

      const controller = new AbortController();
      const abortFromExternal = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
      if (externalSignal?.aborted) abortFromExternal();
      const timeout = setTimeout(() => {
        controller.abort(new DOMException("Base Account status request timed out.", "TimeoutError"));
      }, timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchImpl(rpcUrl, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "X-Cbw-Sdk-Version": "2.5.10",
              "X-Cbw-Sdk-Platform": "@base-org/account",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "wallet_getCallsStatus",
              params: [handle],
            }),
            cache: "no-store",
            signal: controller.signal,
          });
        } catch {
          if (externalSignal?.aborted) return { status: "unavailable" };
          circuitOpenUntil = now() + CIRCUIT_BREAKER_MS;
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return await fallback(row, externalSignal);
        }

        if (response.status !== 200) {
          if (response.status === 429 || response.status >= 500) {
            circuitOpenUntil = now() + CIRCUIT_BREAKER_MS;
          }
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return await fallback(row, externalSignal);
        }

        let payload: unknown;
        try {
          payload = JSON.parse(await response.text()) as unknown;
        } catch {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return await fallback(row, externalSignal);
        }

        if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1) {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return await fallback(row, externalSignal);
        }
        if ("error" in payload) {
          const error = isRecord(payload.error) ? payload.error : null;
          const delay = typeof error?.code === "number" && unknownHandleCodes.has(error.code)
            ? UNKNOWN_HANDLE_BACKOFF_MS
            : UNAVAILABLE_BACKOFF_MS;
          backoff(handle, now() + delay);
          return await fallback(row, externalSignal);
        }

        const resolution = parseResult(payload.result, handle);
        if (resolution.status === "unavailable") {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
        } else if (resolution.status === "reverted" || resolution.status === "not_submitted") {
          backoff(handle, now() + UNKNOWN_HANDLE_BACKOFF_MS);
        } else {
          handleBackoffs.delete(handle);
        }
        return resolution.status === "unavailable" ? await fallback(row, externalSignal) : resolution;
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abortFromExternal);
      }
    } catch {
      return await fallback(row, externalSignal);
    }
  };

  async function fallback(row: ActionRow, signal?: AbortSignal): Promise<HandleResolution> {
    if (!row.provider_handle || !transactionHashPattern.test(row.provider_handle)) return { status: "unavailable" };
    const found = await logLookup(row, signal);
    if (found.status !== "complete") return found;
    return { ...found, code: `BASE_${found.code}` };
  }
}

function parseResult(result: unknown, handle: string): HandleResolution {
  if (
    !isRecord(result) ||
    result.id !== handle ||
    result.version !== "2.0.0" ||
    parseChainId(result.chainId) !== 8453 ||
    result.atomic !== true ||
    typeof result.status !== "number" ||
    !Number.isSafeInteger(result.status)
  ) {
    return { status: "unavailable" };
  }
  if (result.status >= 100 && result.status < 200) return { status: "pending" };
  if (result.status >= 400 && result.status < 500) return { status: "not_submitted" };
  if (result.status < 200 || result.status >= 700 || result.status >= 300 && result.status < 400) return { status: "unavailable" };
  if (!Array.isArray(result.receipts) || result.receipts.length < 1) {
    return result.status >= 500 ? { status: "reverted" } : { status: "unavailable" };
  }
  const hashes = new Set(result.receipts.map((receipt) =>
    isRecord(receipt) && typeof receipt.transactionHash === "string"
      ? receipt.transactionHash.toLowerCase()
      : "",
  ));
  const transactionHash = hashes.values().next().value;
  const validHash = hashes.size === 1 && typeof transactionHash === "string" && transactionHashPattern.test(transactionHash)
    ? transactionHash as `0x${string}` : null;
  if (result.status >= 500) return validHash ? { status: "reverted", transactionHash: validHash } : { status: "reverted" };
  return validHash ? { status: "complete", transactionHash: validHash } : { status: "unavailable" };
}

function parseChainId(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
