import "server-only";

import {
  registryActivityTokenMetadata,
  sanitizeActivityTokenDecimals,
  sanitizeDynamicActivityTokenMetadata,
  sanitizeActivityTokenImageUrl,
  type ActivityTokenMetadata,
} from "@/shared/activity/metadata";
import { getResolvedAssetIcons } from "@/server/market-data/asset-icons/resolve";
import {
  createCodexTokenLookup,
  type CodexTokenLookupEntry,
} from "@/server/market-data/codex/token-lookup";
import {
  createActivityTokenRpcResolver,
  type ActivityOnchainTokenResult,
} from "./token-metadata-rpc";

export const ACTIVITY_TOKEN_CODEX_TIMEOUT_MS = 3_000;
export const ACTIVITY_ASSET_ICON_WAIT_MS = 750;

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
  assetIcons?: LatestAssetIcons;
  iconWaitMs?: number;
} = {}) {
  const codexLookup = options.codexLookup ?? getActivityCodexTokenLookup;
  const rpcLookup = options.rpcLookup ?? createActivityTokenRpcResolver();
  const assetIcons = options.assetIcons ?? createLatestAssetIcons(getResolvedAssetIcons);
  const iconWaitMs = options.iconWaitMs ?? ACTIVITY_ASSET_ICON_WAIT_MS;

  return async function resolveActivityTokenMetadata(
    addresses: readonly `0x${string}`[],
    signal?: AbortSignal,
  ): Promise<ActivityTokenMetadataResolution> {
    const unique = [...new Set(addresses.map((address) =>
      address.toLowerCase() as `0x${string}`,
    ))].slice(0, 25);
    const metadata = new Map<string, ActivityTokenMetadata>();
    const unresolved: `0x${string}`[] = [];
    const registryAddresses: `0x${string}`[] = [];

    for (const address of unique) {
      const registry = registryActivityTokenMetadata(address);
      if (registry) {
        metadata.set(address, registry);
        registryAddresses.push(address);
      } else {
        metadata.set(address, unknownMetadata());
        unresolved.push(address);
      }
    }

    const iconWait = registryAddresses.length > 0
      ? waitForAssetIcons(assetIcons, iconWaitMs, signal)
      : Promise.resolve();
    if (unresolved.length === 0) {
      await iconWait;
      attachRegistryIcons(metadata, registryAddresses, assetIcons.current());
      return { metadata, nftLikeContracts: new Set() };
    }

    const codexDecimals = new Map<string, number>();
    const [, codex] = await Promise.all([
      iconWait,
      (async () => {
        try {
          return await codexLookup(unresolved);
        } catch {
          return new Map<string, CodexTokenLookupEntry>();
        }
      })(),
    ]);
    attachRegistryIcons(metadata, registryAddresses, assetIcons.current());

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
      if (sanitized.tokenSymbol !== null) metadata.set(address, {
        ...sanitized,
        tokenImageUrl: sanitizeActivityTokenImageUrl(entry.imageUrl, "dynamic"),
      });
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

async function waitForAssetIcons(
  assetIcons: LatestAssetIcons,
  iconWaitMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const refresh = Promise.resolve().then(() => assetIcons.refresh()).then(
    () => undefined,
    () => undefined,
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const bounded = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, iconWaitMs);
    onAbort = resolve;
    if (signal?.aborted) resolve();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([refresh, bounded]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function unknownMetadata(): ActivityTokenMetadata {
  return { assetId: null, tokenSymbol: null, tokenDecimals: null, tokenImageUrl: null };
}

export type LatestAssetIcons = {
  refresh(): Promise<void>;
  current(): Record<string, string | null>;
};

export function createLatestAssetIcons(
  readAssetIcons: () => Promise<Record<string, string | null>>,
): LatestAssetIcons {
  let latest: Record<string, string | null> = {};
  let inFlight: Promise<void> | null = null;
  return {
    refresh() {
      inFlight ??= Promise.resolve()
        .then(readAssetIcons)
        .then((icons) => { latest = icons; }, () => undefined)
        .finally(() => { inFlight = null; });
      return inFlight;
    },
    current: () => latest,
  };
}

function attachRegistryIcons(
  metadata: Map<string, ActivityTokenMetadata>,
  addresses: readonly `0x${string}`[],
  icons: Record<string, string | null>,
): void {
  for (const address of addresses) {
    const registry = metadata.get(address)!;
    metadata.set(address, {
      ...registry,
      tokenImageUrl: sanitizeActivityTokenImageUrl(icons[registry.assetId!], "registry"),
    });
  }
}

export const resolveActivityTokenMetadata =
  createActivityTokenMetadataResolver();
