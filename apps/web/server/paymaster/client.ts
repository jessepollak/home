import "server-only";

import { USDC_PAYMASTER_CONTEXT } from "@/shared/money-actions/network-fee";
import { getPaymasterUrl } from "./config";

export const PAYMASTER_METHODS = ["pm_getPaymasterStubData", "pm_getPaymasterData", "pm_getAcceptedPaymentTokens"] as const;
export type PaymasterMethod = (typeof PAYMASTER_METHODS)[number];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class PaymasterError extends Error {
  constructor(message = "The USDC network fee quote is unavailable.") {
    super(message);
    this.name = "PaymasterError";
  }
}

export function createPaymasterClient(options: { fetchImpl?: FetchLike; url?: string; timeoutMs?: number } = {}) {
  return {
    async request(method: PaymasterMethod, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
      const url = options.url ?? getPaymasterUrl();
      if (!url || !/^https:\/\//i.test(url) || !PAYMASTER_METHODS.includes(method)) throw new PaymasterError();
      const timeoutMs = options.timeoutMs ?? 8000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new PaymasterError();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timeout = setTimeout(abort, timeoutMs);
      try {
        const body = { jsonrpc: "2.0", id: 1, method, params: [...params.slice(0, method === "pm_getAcceptedPaymentTokens" ? 2 : 3), USDC_PAYMASTER_CONTEXT] };
        const response = await (options.fetchImpl ?? fetch)(url, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new PaymasterError();
        const payload: unknown = await response.json();
        if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1) throw new PaymasterError();
        if (isRecord(payload.error)) throw new PaymasterError();
        if (!("result" in payload)) throw new PaymasterError();
        return payload.result;
      } catch {
        throw new PaymasterError();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
