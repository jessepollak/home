import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_GRAPHQL_ENDPOINT,
} from "@/shared/savings/config";
import { parseLosslessJson } from "./lossless-json";
import {
  MorphoSchemaError,
  normalizeVaultCandidate,
} from "./normalize";
import {
  MORPHO_API_VERSION,
  type MorphoSource,
  type MorphoVaultsResult,
} from "@/shared/savings/types";

const REQUEST_TIMEOUT_MS = 8_000;
const FRESH_CACHE_MS = 30_000;
const STALE_FALLBACK_MS = 5 * 60_000;

const VAULTS_QUERY = `query HomeBaseUsdcVaultsV1 {
  vaults(
    first: 50
    orderBy: TotalAssetsUsd
    orderDirection: Desc
    where: {
      chainId_in: [8453]
      assetAddress_in: ["${BASE_USDC_ADDRESS}"]
    }
  ) {
    items {
      address
      name
      symbol
      listed
      chain { id network }
      asset { address symbol decimals }
      state {
        timestamp
        blockNumber
        apy
        netApy
        fee
        curator
        totalAssets
      }
      liquidity { underlying }
    }
  }
}`;

type FetchLike = typeof fetch;

type CacheEntry = {
  storedAt: number;
  result: MorphoVaultsResult;
};

type VaultCandidatesReaderOptions = {
  signal?: AbortSignal;
  now?: () => Date;
};

export class MorphoUpstreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MorphoUpstreamError";
  }
}

export function createMorphoVaultCandidatesReader(fetchImpl: FetchLike) {
  let vaultCache: CacheEntry | null = null;
  let vaultRequest: Promise<MorphoVaultsResult> | null = null;

  return async function readMorphoVaultCandidates(
    options?: VaultCandidatesReaderOptions,
  ): Promise<MorphoVaultsResult> {
    const now = options?.now ?? (() => new Date());
    const useSharedCache = options?.signal === undefined;
    const currentTime = now().getTime();

    if (
      useSharedCache &&
      vaultCache &&
      currentTime - vaultCache.storedAt <= FRESH_CACHE_MS
    ) {
      return { ...vaultCache.result, stale: false };
    }

    if (useSharedCache && vaultRequest) return vaultRequest;

    const request = fetchVaultCandidates(fetchImpl, options?.signal, now).catch(
      (error: unknown) => {
        if (
          useSharedCache &&
          vaultCache &&
          currentTime - vaultCache.storedAt <= STALE_FALLBACK_MS
        ) {
          return { ...vaultCache.result, stale: true };
        }
        throw error;
      },
    );

    if (!useSharedCache) return request;

    vaultRequest = request;
    try {
      const result = await request;
      if (!result.stale) {
        vaultCache = { storedAt: now().getTime(), result };
      }
      return result;
    } finally {
      vaultRequest = null;
    }
  };
}

let sharedVaultCandidatesReader = createMorphoVaultCandidatesReader(fetch);

export async function getMorphoVaultCandidates(options?: {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<MorphoVaultsResult> {
  const reader = options?.fetchImpl
    ? createMorphoVaultCandidatesReader(options.fetchImpl)
    : sharedVaultCandidatesReader;

  return reader({ signal: options?.signal, now: options?.now });
}

async function fetchVaultCandidates(
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
  now: () => Date,
): Promise<MorphoVaultsResult> {
  const source = createSource("vaults", now());
  const payload = await executeGraphql(
    VAULTS_QUERY,
    undefined,
    fetchImpl,
    signal,
  );
  const data = readRecord(payload, "response.data");
  const vaults = readRecord(data.vaults, "response.data.vaults");
  if (!Array.isArray(vaults.items)) {
    throw new MorphoSchemaError("response.data.vaults.items must be an array.");
  }

  const candidates = vaults.items
    .map((vault) => normalizeVaultCandidate(vault, source))
    .filter((vault) => vault !== null);

  if (candidates.length === 0) {
    throw new MorphoSchemaError(
      "Morpho returned no matching configured Base USDC V1 vaults.",
    );
  }

  return {
    version: MORPHO_API_VERSION,
    chainId: BASE_CHAIN_ID,
    asset: {
      address: BASE_USDC_ADDRESS,
      symbol: "USDC",
      decimals: BASE_USDC_DECIMALS,
    },
    candidates,
    source,
    stale: false,
  };
}

async function executeGraphql(
  query: string,
  variables: Record<string, string> | undefined,
  fetchImpl: FetchLike,
  externalSignal: AbortSignal | undefined,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  try {
    const response = await fetchImpl(MORPHO_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MorphoUpstreamError(
        `Morpho GraphQL returned HTTP ${response.status}.`,
      );
    }

    const parsed = parseLosslessJson(await response.text());
    const envelope = readRecord(parsed, "response");
    if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
      throw new MorphoUpstreamError("Morpho GraphQL returned an error response.");
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new MorphoUpstreamError("Morpho GraphQL returned no data.");
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof MorphoUpstreamError || error instanceof MorphoSchemaError) {
      throw error;
    }
    const message = controller.signal.aborted
      ? "Morpho GraphQL request timed out or was aborted."
      : "Morpho GraphQL request failed.";
    throw new MorphoUpstreamError(message, { cause: error });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function createSource(
  query: "vaults",
  fetchedAt: Date,
): MorphoSource {
  return {
    provider: "Morpho GraphQL",
    endpoint: MORPHO_GRAPHQL_ENDPOINT,
    query,
    fetchedAt: fetchedAt.toISOString(),
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MorphoSchemaError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function clearMorphoCacheForTests() {
  sharedVaultCandidatesReader = createMorphoVaultCandidatesReader(fetch);
}
