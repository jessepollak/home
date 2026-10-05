import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMorphoVaultCandidatesReader } from "@/server/morpho/client";
import {
  type MorphoVaultsResult,
  parseVaultsResult,
} from "@/shared/savings/contracts/vaults";

const vaults: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6,
  },
  candidates: [{
    version: "v1",
    vaultAddress: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    name: "Gauntlet USDC Prime",
    symbol: "gtUSDCp",
    listed: true,
    chainId: 8453,
    asset: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      decimals: 6,
    },
    curatorAddress: "0x9E33faAE38ff641094fa68c65c2cE600b3410585",
    grossApy: 0.04,
    netApy: 0.035,
    feeRate: 0,
    totalAssetsRaw: "1000000",
    liquidityRaw: "750000",
    stateAsOf: "2026-09-07T20:00:00.000Z",
    blockNumber: "35123456",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-07T20:30:00.000Z",
    },
  }],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-07T20:30:00.000Z",
  },
  stale: false,
};

const getMorphoVaultCandidates = mock(async (): Promise<MorphoVaultsResult> => vaults);
const actualMorpho = { ...await import("@/server/morpho") };
await mock.module("@/server/morpho", () => ({
  ...actualMorpho,
  getMorphoVaultCandidates,
}));
const actualNextServer = { ...await import("next/server") };
const connection = mock(async () => {});
await mock.module("next/server", () => ({ ...actualNextServer, connection }));
const { GET } = await import("./route");

beforeEach(() => {
  getMorphoVaultCandidates.mockReset();
  getMorphoVaultCandidates.mockResolvedValue(vaults);
  connection.mockClear();
});
afterAll(async () => {
  await mock.module("@/server/morpho", () => actualMorpho);
  await mock.module("next/server", () => actualNextServer);
  mock.restore();
});
describe("GET /api/savings/vaults", () => {
  test("returns public vault candidates that round-trip through the shared parser", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=15, stale-while-revalidate=45",
    );
    const parsed = parseVaultsResult(await response.json());
    expect(parsed).not.toBeNull();
    expect(parsed?.candidates).toEqual(vaults.candidates);
    expect(parsed?.version).toBe("v1");
    expect(parsed?.chainId).toBe(8453);
    expect(parsed?.stale).toBeFalse();
  });

  test("round-trips exact amounts and partial observations in the actual handler body", async () => {
    const partial = { ...vaults, candidates: vaults.candidates.map((candidate) => ({
      ...candidate, totalAssetsRaw: "900719925474099312345", liquidityRaw: null,
      grossApy: null, netApy: null, feeRate: null, stateAsOf: null, blockNumber: null,
    })) };
    getMorphoVaultCandidates.mockResolvedValueOnce(partial);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(parseVaultsResult(await response.json())).toEqual(partial);
  });

  test("rejects malformed provider fees before responding or caching and allows a valid retry", async () => {
    let calls = 0;
    let fee = 1e308;
    const reader = createMorphoVaultCandidatesReader(Object.assign(async () => {
      calls += 1;
      return Response.json({ data: { vaults: { items: [{
        address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
        name: "Gauntlet USDC Prime", symbol: "gtUSDCp", listed: true,
        chain: { id: 8453, network: "Base" },
        asset: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
        state: {
          timestamp: 1788811200, blockNumber: 35123456, apy: 0.04, netApy: 0.035, fee,
          curator: "0x9E33faAE38ff641094fa68c65c2cE600b3410585", totalAssets: 1000000,
        },
        liquidity: { underlying: 750000 },
      }] } } });
    }, { preconnect: async () => {} }));
    getMorphoVaultCandidates.mockImplementation(() => reader({ now: () => new Date("2026-09-07T20:30:00.000Z") }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await GET();
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: "vault-data-unavailable" });
    }
    expect(calls).toBe(2);

    fee = 0;
    const recovered = await GET();
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=45");
    const parsed = parseVaultsResult(await recovered.json());
    expect(parsed).not.toBeNull();
    expect(parsed?.candidates[0]?.feeRate).toBe(0);
    expect(parsed?.stale).toBeFalse();
    expect(calls).toBe(3);
    const cached = await GET();
    expect(cached.status).toBe(200);
    expect(parseVaultsResult(await cached.json())).toEqual(parsed);
    expect(calls).toBe(3);
  });

  test("returns an uncached unavailable response when the provider rejects", async () => {
    getMorphoVaultCandidates.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await GET();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "vault-data-unavailable" });
  });
});
