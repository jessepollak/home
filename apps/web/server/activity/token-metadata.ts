import "server-only";

import {
  registryActivityTokenMetadata,
  sanitizeActivityTokenDecimals,
  sanitizeDynamicActivityTokenMetadata,
  type ActivityTokenMetadata,
} from "@/shared/activity/metadata";
import {
  createCodexTokenLookup,
  type CodexTokenLookupEntry,
} from "@/server/market-data/codex/token-lookup";
import {
  createActivityTokenRpcResolver,
  type ActivityOnchainTokenResult,
} from "./token-metadata-rpc";

export const ACTIVITY_TOKEN_CODEX_TIMEOUT_MS = 3_000;

export type ActivityTokenMetadataResolution = {
  metadata: Map<string, ActivityTokenMetadata>;
  nftLikeContracts: Set<string>;
};

type CodexLookup = (
  addresses: readonly `0x${string}`[],
) => Promise<Map<string, CodexTokenLookupEntry>>;

type RpcLookup = (
  addresses: readonly `0x${string}`[],
  signal?: AbortSignal,
) => Promise<Map<string, ActivityOnchainTokenResult>>;

let activityCodexLookup: ReturnType<typeof createCodexTokenLookup> | null = null;
let activityCodexApiKey: string | undefined;

function getActivityCodexTokenLookup(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, CodexTokenLookupEntry>> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!activityCodexLookup || activityCodexApiKey !== apiKey) {
    activityCodexApiKey = apiKey;
    activityCodexLookup = createCodexTokenLookup({
      apiKey,
      timeoutMs: ACTIVITY_TOKEN_CODEX_TIMEOUT_MS,
    });
  }
  return activityCodexLookup(addresses);
}

export function createActivityTokenMetadataResolver(options: {
  codexLookup?: CodexLookup;
  rpcLookup?: RpcLookup;
} = {}) {
  const codexLookup = options.codexLookup ?? getActivityCodexTokenLookup;
  const rpcLookup = options.rpcLookup ?? createActivityTokenRpcResolver();

  return async function resolveActivityTokenMetadata(
    addresses: readonly `0x${string}`[],
    signal?: AbortSignal,
  ): Promise<ActivityTokenMetadataResolution> {
    const unique = [...new Set(addresses.map((address) =>
      address.toLowerCase() as `0x${string}`,
    ))].slice(0, 25);
    const metadata = new Map<string, ActivityTokenMetadata>();
    const unresolved: `0x${string}`[] = [];

    for (const address of unique) {
      const registry = registryActivityTokenMetadata(address);
      if (registry) metadata.set(address, registry);
      else {
        metadata.set(address, unknownMetadata());
        unresolved.push(address);
      }
    }

    if (unresolved.length === 0) {
      return { metadata, nftLikeContracts: new Set() };
    }

    const codexDecimals = new Map<string, number>();
    let codex = new Map<string, CodexTokenLookupEntry>();
    try {
      codex = await codexLookup(unresolved);
    } catch {
      // Metadata is optional. Continue to the read-only onchain fallback.
    }

    const rpcAddresses: `0x${string}`[] = [];
    for (const address of unresolved) {
      const entry = codex.get(address);
      if (!entry) {
        rpcAddresses.push(address);
        continue;
      }
      const decimals = sanitizeActivityTokenDecimals(entry.decimals);
      if (decimals !== null) codexDecimals.set(address, decimals);
      const sanitized = sanitizeDynamicActivityTokenMetadata({
        symbol: entry.symbol,
        decimals: entry.decimals,
      });
      if (sanitized.tokenSymbol !== null) metadata.set(address, sanitized);
      else rpcAddresses.push(address);
    }

    const nftLikeContracts = new Set<string>();
    if (rpcAddresses.length === 0) return { metadata, nftLikeContracts };

    let onchain: Map<string, ActivityOnchainTokenResult>;
    try {
      onchain = await rpcLookup(rpcAddresses, signal);
    } catch {
      return { metadata, nftLikeContracts };
    }

    for (const address of rpcAddresses) {
      const result = onchain.get(address);
      if (result?.kind === "nft-like") {
        if (!codex.has(address)) nftLikeContracts.add(address);
        continue;
      }
      if (result?.kind !== "metadata") continue;
      const codexDecimal = codexDecimals.get(address);
      if (codexDecimal !== undefined && codexDecimal !== result.decimals) {
        metadata.set(address, unknownMetadata());
        continue;
      }
      metadata.set(
        address,
        sanitizeDynamicActivityTokenMetadata({
          symbol: result.symbol,
          decimals: result.decimals,
        }),
      );
    }

    return { metadata, nftLikeContracts };
  };
}

function unknownMetadata(): ActivityTokenMetadata {
  return { assetId: null, tokenSymbol: null, tokenDecimals: null };
}

export const resolveActivityTokenMetadata =
  createActivityTokenMetadataResolver();
