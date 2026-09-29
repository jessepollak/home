import "server-only";

import type { ImmersveConfig } from "./config";

type ClientConfig = Pick<ImmersveConfig, "origin" | "apiKey" | "apiSecret">;
const TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export function createImmersveClient(config: ClientConfig, options: { fetchImplementation?: typeof fetch; timeoutMs?: number } = {}) {
  if (config.origin !== "https://test.immersve.com" && config.origin !== "https://api.immersve.com") {
    throw new Error("Invalid Immersve origin");
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) throw new Error("Invalid Immersve timeout");
  const transport = options.fetchImplementation ?? fetch;

  async function getJson(path: string, authenticated: boolean): Promise<unknown> {
    const url = new URL(path, config.origin);
    if (url.origin !== config.origin || url.protocol !== "https:") throw new Error("Invalid Immersve URL");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Immersve request timed out"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([request(), timeout]);
    } finally {
      controller.abort();
      if (timer) clearTimeout(timer);
    }

    async function request(): Promise<unknown> {
      let response: Response;
      try {
        response = await transport(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: authenticated
            ? { accept: "application/json", "x-api-key": config.apiKey, "x-api-secret": config.apiSecret }
            : { accept: "application/json" },
        });
      } catch {
        throw new Error("Immersve request failed");
      }
      if (response.status !== 200) throw new Error(`Immersve response status ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty Immersve response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error("Immersve response too large");
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => undefined);
      }
      try {
        return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8")) as unknown;
      } catch {
        throw new Error("Invalid Immersve response");
      }
    }
  }

  return Object.freeze({
    getJwks: () => getJson("/.well-known/jwks.json", false),
    getSupportedRegions: (partnerAccountId: string) => {
      if (!/^[a-fA-F0-9]{32}$/.test(partnerAccountId)) throw new Error("Invalid Immersve partner ID");
      return getJson(`/api/accounts/${partnerAccountId}/supported-regions`, true);
    },
  });
}
