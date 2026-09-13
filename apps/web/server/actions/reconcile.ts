import "server-only";

import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import type { ActionRow } from "./store";

export type HandleResolution =
  | { status: "complete"; transactionHash: `0x${string}` }
  | { status: "pending" }
  | { status: "failed" }
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
// Intentionally below handler.ts RECONCILE_DEADLINE_MS (3,000ms) so provider hangs open the breaker first.
const DEFAULT_TIMEOUT_MS = 2_500;
const CIRCUIT_BREAKER_MS = 60_000;
const UNKNOWN_HANDLE_BACKOFF_MS = 5 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 30_000;
const MAX_HANDLE_BACKOFFS = 500;
const handlePattern = /^[\x21-\x7e]{1,512}$/;
const transactionHashPattern = /^0x[0-9a-f]{64}$/;
const unknownHandleCodes = new Set([-32602, 4200, 5730]);

export function createActionHandleResolver(
  options: {
    fetchImpl?: FetchLike;
    walletRpcUrl?: string;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): ActionHandleResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new Error("The Base Account status timeout must be 1-10000ms.");
  }
  const configuredUrl = (options.walletRpcUrl ?? process.env.BASE_ACCOUNT_STATUS_RPC_URL)?.trim() || DEFAULT_STATUS_RPC_URL;
  // Resolved lazily so a bad optional override degrades to "unavailable" instead of failing the route at load.
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
      if (currentTime < circuitOpenUntil) return { status: "unavailable" };
      const handleBackoffUntil = handleBackoffs.get(handle) ?? 0;
      if (currentTime < handleBackoffUntil) return { status: "unavailable" };
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
            // Mirrors the identifying headers sent by @base-org/account 2.5.10.
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
          const timedOut = controller.signal.reason instanceof DOMException &&
            controller.signal.reason.name === "TimeoutError";
          // A caller abort says nothing about provider health; our timeout and transport failures do.
          if (externalSignal?.aborted && !timedOut) return { status: "unavailable" };
          circuitOpenUntil = now() + CIRCUIT_BREAKER_MS;
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return { status: "unavailable" };
        }

        if (response.status !== 200) {
          if (response.status === 429 || response.status >= 500) {
            circuitOpenUntil = now() + CIRCUIT_BREAKER_MS;
          }
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return { status: "unavailable" };
        }

        let payload: unknown;
        try {
          payload = JSON.parse(await response.text()) as unknown;
        } catch {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return { status: "unavailable" };
        }

        if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1) {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
          return { status: "unavailable" };
        }
        if ("error" in payload) {
          const error = isRecord(payload.error) ? payload.error : null;
          const delay = typeof error?.code === "number" && unknownHandleCodes.has(error.code)
            ? UNKNOWN_HANDLE_BACKOFF_MS
            : UNAVAILABLE_BACKOFF_MS;
          backoff(handle, now() + delay);
          return { status: "unavailable" };
        }

        const resolution = parseResult(payload.result, handle);
        if (resolution.status === "unavailable") {
          backoff(handle, now() + UNAVAILABLE_BACKOFF_MS);
        } else if (resolution.status === "failed") {
          backoff(handle, now() + UNKNOWN_HANDLE_BACKOFF_MS);
        } else {
          handleBackoffs.delete(handle);
        }
        return resolution;
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abortFromExternal);
      }
    } catch {
      return { status: "unavailable" };
    }
  };
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
  if (result.status >= 300 && result.status < 700) return { status: "failed" };
  if (result.status < 200 || result.status >= 300) return { status: "unavailable" };
  if (!Array.isArray(result.receipts) || result.receipts.length < 1) {
    return { status: "unavailable" };
  }
  const hashes = new Set(result.receipts.map((receipt) =>
    isRecord(receipt) && typeof receipt.transactionHash === "string"
      ? receipt.transactionHash.toLowerCase()
      : "",
  ));
  if (hashes.size !== 1) return { status: "unavailable" };
  const transactionHash = hashes.values().next().value;
  return typeof transactionHash === "string" && transactionHashPattern.test(transactionHash)
    ? { status: "complete", transactionHash: transactionHash as `0x${string}` }
    : { status: "unavailable" };
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
