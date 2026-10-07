import "server-only";

import { createBoundedCache } from "@/server/cache/bounded";
import { createUpstreamDeadline, upstreamRequest } from "@/server/http/upstream";
import { parseExactDecimal } from "@/shared/balances/math";
import { parseAddress } from "@/shared/chain/hex";
import { isRecord } from "@/shared/guards";
import type { TokenRisk, TokenRiskSignals } from "@/shared/invest/contracts/market-stats";

type RiskIdentity = { chainId: number; contractAddress: string };
type ReaderOptions = {
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
  now?: () => number;
  clock?: Parameters<typeof createUpstreamDeadline>[0]["clock"];
  timeoutMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  maxInFlight?: number;
  lastGoodTtlMs?: number;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : null;
}

function emptyRisk(contractAddress: string, status: "unsupported" | "throttled" | "error"): TokenRisk {
  return { source: "goplus", chainId: 8453, contractAddress, status, checkedAt: null };
}

function readFlag(value: unknown): TokenRiskSignals["honeypot"] {
  return value === "1" ? "reported" : value === "0" ? "absent" : "unknown";
}

function readTax(value: unknown): TokenRiskSignals["buyTax"] {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,36})?$/.test(value)) {
    return { state: "unknown" };
  }
  const fraction = parseExactDecimal(value);
  if (!fraction || fraction.scale > 36 || BigInt(fraction.atoms) > BigInt(10) ** BigInt(fraction.scale)) {
    return { state: "unknown" };
  }
  return BigInt(fraction.atoms) === BigInt(0) ? { state: "absent" } : { state: "reported", fraction };
}

export function normalizeGoPlusTokenSecurity(
  payload: unknown,
  contractAddress: string,
  checkedAt: string,
): TokenRisk {
  const envelope = readRecord(payload);
  if (envelope?.code !== 1) {
    return emptyRisk(contractAddress, envelope?.code === 4029 ? "throttled" : "error");
  }
  const result = readRecord(envelope.result);
  if (!result) return emptyRisk(contractAddress, "error");
  if (Object.keys(result).length === 0) return emptyRisk(contractAddress, "unsupported");
  const entry = Object.hasOwn(result, contractAddress) ? readRecord(result[contractAddress]) : null;
  if (!entry) return emptyRisk(contractAddress, "error");
  const signals: TokenRiskSignals = {
    honeypot: readFlag(entry.is_honeypot),
    cannotSellAll: readFlag(entry.cannot_sell_all),
    transferPausable: readFlag(entry.transfer_pausable),
    blacklist: readFlag(entry.is_blacklisted),
    taxModifiable: readFlag(entry.slippage_modifiable),
    personalTaxModifiable: readFlag(entry.personal_slippage_modifiable),
    buyTax: readTax(entry.buy_tax),
    sellTax: readTax(entry.sell_tax),
    transferTax: readTax(entry.transfer_tax),
  };
  return { source: "goplus", chainId: 8453, contractAddress, status: "ready", checkedAt, signals };
}

export function createGoPlusTokenRiskReader({
  fetchImpl = fetch,
  now = Date.now,
  clock,
  timeoutMs = 5_000,
  ttlMs = 300_000,
  maxEntries = 256,
  maxInFlight = 4,
  lastGoodTtlMs = 86_400_000,
}: ReaderOptions = {}) {
  const cache = createBoundedCache<TokenRisk>({
    maxEntries, ttlMs, maxInFlight, now,
    retain: (value) => value.status === "ready",
  });
  const lastGood = createBoundedCache<TokenRisk>({
    maxEntries, ttlMs: lastGoodTtlMs, maxInFlight, now,
  });

  return async function readGoPlusTokenRisk(identity: RiskIdentity): Promise<TokenRisk> {
    const address = identity.contractAddress.toLowerCase();
    if (identity.chainId !== 8453) return emptyRisk(address, "unsupported");
    if (parseAddress(address) === null) return emptyRisk(address, "error");
    const key = `${identity.chainId}:${address}`;
    try {
      const result = await cache.fetch(key, async () => {
        try {
          const response = await upstreamRequest(
            `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${address}`,
            {
              deadline: createUpstreamDeadline({ timeoutMs, clock }),
              maxBytes: 256 * 1024,
              init: { headers: { accept: "application/json" } },
              fetchImpl,
            },
          );
          const value = response.ok
            ? normalizeGoPlusTokenSecurity(response.value, address, new Date(now()).toISOString())
            : emptyRisk(address, response.kind === "http" && response.status === 429 ? "throttled" : "error");
          if (value.status === "ready") lastGood.set(key, value);
          return value;
        } catch {
          return emptyRisk(address, "error");
        }
      });
      const value = result.status === "saturated" ? emptyRisk(address, "throttled") : result.value;
      if (value.status === "error" || value.status === "throttled") {
        const previous = lastGood.get(key);
        if (previous?.status === "ready") return { ...previous, status: "stale" };
      }
      return value;
    } catch {
      const previous = lastGood.get(key);
      return previous?.status === "ready" ? { ...previous, status: "stale" } : emptyRisk(address, "error");
    }
  };
}

let sharedReader: ReturnType<typeof createGoPlusTokenRiskReader> | null = null;

export function getGoPlusTokenRisk(identity: RiskIdentity): Promise<TokenRisk> {
  sharedReader ??= createGoPlusTokenRiskReader();
  return sharedReader(identity);
}
