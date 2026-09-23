import "server-only";

import { createPublicClient, getAddress, http, namehash, parseAbi } from "viem";
import { base, mainnet } from "viem/chains";
import { resolveBaseRpcUrl, resolveEthereumRpcUrl } from "@/server/chain/rpc";
import {
  normalizeResolvedRecipientAddress,
  normalizeTransferRecipientName,
} from "@/shared/transfers/recipient-name";
import { RECENT_TRANSFER_RECIPIENT_LIMIT } from "@/shared/transfers/contracts/recipients";

const REVERSE_RESOLVER_ORIGIN = "https://api.ensideas.com";
const REVERSE_RESOLVER_PATH = "/ens/resolve/";
export const BASE_ENS_COIN_TYPE = (0x80000000 | base.id) >>> 0;
const BASENAME_REGISTRY_ADDRESS = getAddress("0xB94704422c2a1E396835A571837Aa5AE53285a95");
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_LABEL_LOOKUPS = RECENT_TRANSFER_RECIPIENT_LIMIT;
const RESOLUTION_CACHE_TTL_MS = 60_000;
const RESOLUTION_CACHE_MAX_ENTRIES = 512;
const resolverAbi = parseAbi(["function addr(bytes32 node) view returns (address)"]);
const registryAbi = parseAbi(["function resolver(bytes32 node) view returns (address)"]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ForwardLookup = (
  name: string,
  options: { signal: AbortSignal },
) => Promise<unknown>;

export type TransferRecipientNameResolver = (
  name: string,
  options?: { signal?: AbortSignal },
) => Promise<`0x${string}` | null>;

export type TransferRecipientLabelResolver = (
  addresses: readonly `0x${string}`[],
  options?: { signal?: AbortSignal },
) => Promise<ReadonlyMap<`0x${string}`, string>>;

export function reverseResolverUrl(value: string): string {
  return `${REVERSE_RESOLVER_ORIGIN}${REVERSE_RESOLVER_PATH}${encodeURIComponent(value)}`;
}

export function parseResolvedRecipientName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["name", "ens", "basename", "displayName"] as const) {
    const name = normalizeTransferRecipientName(value[key]);
    if (name) return name;
  }
  return null;
}

export async function resolveTransferRecipientName(
  value: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    resolveBasename?: ForwardLookup;
    resolveEnsName?: ForwardLookup;
  } = {},
): Promise<`0x${string}` | null> {
  const name = normalizeTransferRecipientName(value);
  if (!name) return null;
  const signal = resolverSignal(options.signal, options.timeoutMs);
  try {
    const resolved = name.endsWith(".base.eth")
      ? await (options.resolveBasename ?? resolveBasenameOnBase)(name, { signal })
      : await (options.resolveEnsName ?? resolveEnsOnMainnet)(name, { signal });
    return normalizeResolvedRecipientAddress(resolved);
  } catch {
    return null;
  }
}

export async function resolveTransferRecipientLabels(
  addresses: readonly `0x${string}`[],
  options: {
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    resolveName?: TransferRecipientNameResolver;
  } = {},
): Promise<ReadonlyMap<`0x${string}`, string>> {
  const unique: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    const normalized = normalizeResolvedRecipientAddress(address);
    const identity = normalized?.toLowerCase();
    if (normalized && identity && !seen.has(identity)) {
      seen.add(identity);
      unique.push(normalized);
    }
    if (unique.length === MAX_LABEL_LOOKUPS) break;
  }
  const resolved = await Promise.all(unique.map(async (address) => {
    const payload = await requestReverseResolver(address, options);
    const name = payload === null ? null : parseResolvedRecipientName(payload);
    if (!name) return null;
    const forward = await (options.resolveName ?? resolveTransferRecipientName)(name, {
      signal: options.signal,
    });
    return forward?.toLowerCase() === address.toLowerCase() ? { address, name } : null;
  }));
  return new Map(resolved.flatMap((entry) => (entry ? [[entry.address, entry.name] as const] : [])));
}

export class ResolverTtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const record = this.entries.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, record);
    return record.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const recipientNameCache = new ResolverTtlCache<`0x${string}`>(
  RESOLUTION_CACHE_TTL_MS,
  RESOLUTION_CACHE_MAX_ENTRIES,
);
const recipientLabelCache = new ResolverTtlCache<string | null>(
  RESOLUTION_CACHE_TTL_MS,
  RESOLUTION_CACHE_MAX_ENTRIES,
);

export const resolveTransferRecipientNameCached = async (
  name: string,
  options?: Parameters<typeof resolveTransferRecipientName>[1],
): Promise<`0x${string}` | null> => {
  const key = normalizeTransferRecipientName(name);
  if (!key) return null;
  const cached = recipientNameCache.get(key);
  if (cached !== undefined) return cached;
  const resolved = await resolveTransferRecipientName(name, options);
  if (resolved) recipientNameCache.set(key, resolved);
  return resolved;
};

export const resolveTransferRecipientLabelsCached = async (
  addresses: readonly `0x${string}`[],
  options?: Parameters<typeof resolveTransferRecipientLabels>[1],
): Promise<ReadonlyMap<`0x${string}`, string>> => {
  const unique: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    const normalized = normalizeResolvedRecipientAddress(address);
    const identity = normalized?.toLowerCase();
    if (normalized && identity && !seen.has(identity)) {
      seen.add(identity);
      unique.push(normalized);
    }
    if (unique.length === MAX_LABEL_LOOKUPS) break;
  }
  const labels = new Map<`0x${string}`, string>();
  const misses: `0x${string}`[] = [];
  for (const address of unique) {
    const cached = recipientLabelCache.get(address.toLowerCase());
    if (cached === undefined) {
      misses.push(address);
      continue;
    }
    if (cached !== null) labels.set(address, cached);
  }
  if (misses.length > 0) {
    const resolved = await resolveTransferRecipientLabels(misses, options);
    for (const address of misses) {
      const name = resolved.get(address) ?? null;
      recipientLabelCache.set(address.toLowerCase(), name);
      if (name) labels.set(address, name);
    }
  }
  return labels;
};

async function resolveBasenameOnBase(
  name: string,
  options: { signal: AbortSignal },
): Promise<unknown> {
  const client = createPublicClient({
    chain: base,
    ccipRead: false,
    transport: http(resolveBaseRpcUrl(), { fetchOptions: { signal: options.signal } }),
  });
  const node = namehash(name);
  const registryResolver = await client.readContract({
    address: BASENAME_REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "resolver",
    args: [node],
  });
  const resolverAddress = selectBasenameResolverAddress(registryResolver);
  if (!resolverAddress) return null;
  return await client.readContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: "addr",
    args: [node],
  });
}

export function selectBasenameResolverAddress(registryResolver: unknown): `0x${string}` | null {
  if (
    typeof registryResolver === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(registryResolver) &&
    !/^0x0{40}$/i.test(registryResolver)
  ) {
    return getAddress(registryResolver);
  }
  return null;
}

async function resolveEnsOnMainnet(
  name: string,
  options: { signal: AbortSignal },
): Promise<unknown> {
  const client = createPublicClient({
    chain: mainnet,
    ccipRead: false,
    transport: http(resolveEthereumRpcUrl(), { fetchOptions: { signal: options.signal } }),
  });
  return resolveEnsAddressPreferringBase((coinType) =>
    coinType === undefined
      ? client.getEnsAddress({ name })
      : client.getEnsAddress({ name, coinType: BigInt(coinType) }),
  );
}

export async function resolveEnsAddressPreferringBase(
  readAddress: (coinType: number | undefined) => Promise<unknown>,
): Promise<unknown> {
  const baseAddress = normalizeResolvedRecipientAddress(await readAddress(BASE_ENS_COIN_TYPE));
  if (baseAddress) return baseAddress;
  return await readAddress(undefined);
}

async function requestReverseResolver(
  value: string,
  options: { signal?: AbortSignal; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = resolverSignal(options.signal, options.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(reverseResolverUrl(value), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolverSignal(external: AbortSignal | undefined, timeoutMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new Error("The recipient resolver timeout must be 1-10000ms.");
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
