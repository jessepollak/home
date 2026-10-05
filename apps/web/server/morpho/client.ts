import "server-only";

import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_GRAPHQL_ENDPOINT,
} from "@/shared/savings/config";
import { createUpstreamDeadline, upstreamRequest, type UpstreamDeadline } from "@/server/http/upstream";
import { parseLosslessJson } from "./lossless-json";
import { parseVaultsResult } from "@/shared/savings/contracts/vaults";
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
export const MORPHO_MAX_RESPONSE_BYTES = 256_000;
const REQUEST_RETRY_LIMIT = 1;
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
  timeoutMs?: number;
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

    const deadline = createUpstreamDeadline({
      timeoutMs: options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
      signal: options?.signal,
    });
    const request = fetchVaultCandidates(fetchImpl, deadline, now).catch(
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

const sharedVaultCandidatesReader = createMorphoVaultCandidatesReader(fetch);

export async function getMorphoVaultCandidates(options?: {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
}): Promise<MorphoVaultsResult> {
  const reader = options?.fetchImpl
    ? createMorphoVaultCandidatesReader(options.fetchImpl)
    : sharedVaultCandidatesReader;

  return reader({ signal: options?.signal, now: options?.now, timeoutMs: options?.timeoutMs });
}

async function fetchVaultCandidates(
  fetchImpl: FetchLike,
  deadline: UpstreamDeadline,
  now: () => Date,
): Promise<MorphoVaultsResult> {
  const source = createSource("vaults", now());
  const payload = await executeGraphqlWithRetry(
    VAULTS_QUERY,
    undefined,
    fetchImpl,
    deadline,
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

  const result = parseVaultsResult({
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
  });
  if (result === null) {
    throw new MorphoSchemaError("Normalized Morpho vault data failed validation.");
  }
  return result;
}

async function executeGraphqlWithRetry(
  query: string,
  variables: Record<string, string> | undefined,
  fetchImpl: FetchLike,
  deadline: UpstreamDeadline,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await executeGraphql(query, variables, fetchImpl, deadline);
    } catch (error) {
      if (
        attempt >= REQUEST_RETRY_LIMIT ||
        deadline.interruptionKind() !== undefined ||
        !(error instanceof MorphoUpstreamError)
      ) {
        throw error;
      }
    }
  }
}

async function executeGraphql(
  query: string,
  variables: Record<string, string> | undefined,
  fetchImpl: FetchLike,
  deadline: UpstreamDeadline,
) {
  const result = await upstreamRequest(MORPHO_GRAPHQL_ENDPOINT, {
    deadline,
    maxBytes: MORPHO_MAX_RESPONSE_BYTES,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
    responseType: "text",
    parse: (value) => parseLosslessJson(String(value)),
    fetchImpl,
  });
  if (!result.ok) {
    if (result.kind === "http") {
      throw new MorphoUpstreamError(`Morpho GraphQL returned HTTP ${result.status}.`);
    }
    const cause = "cause" in result ? result.cause : undefined;
    throw new MorphoUpstreamError(
      result.kind === "aborted" || result.kind === "timeout"
        ? "Morpho GraphQL request timed out or was aborted."
        : "Morpho GraphQL request failed.",
      cause === undefined ? undefined : { cause },
    );
  }
  const envelope = readRecord(result.value, "response");
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    throw new MorphoUpstreamError("Morpho GraphQL returned an error response.");
  }
  if (envelope.data === null || envelope.data === undefined) {
    throw new MorphoUpstreamError("Morpho GraphQL returned no data.");
  }
  return envelope.data;
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
