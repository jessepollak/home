import { describe, expect, test } from "bun:test";
import { DEFAULT_VERIFIED_MORPHO_MARKET, type VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import type { MorphoMarketRpcReader, MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";
import { prepareLendAction } from "./prepare";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const market = DEFAULT_VERIFIED_MORPHO_MARKET;

function snapshot(overrides: {
  position?: Partial<MorphoMarketSnapshot["position"]>;
  state?: Partial<MorphoMarketSnapshot["state"]>;
  wallet?: Partial<MorphoMarketSnapshot["wallet"]>;
  capabilities?: MorphoMarketSnapshot["capabilities"];
} = {}): MorphoMarketSnapshot {
  return {
    chainId: 8453,
    walletAddress: OWNER,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    capabilities: overrides.capabilities ?? { borrow: "enabled", lend: "enabled" },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1789329600", fetchedAt: "2026-09-14T12:00:00.000Z" },
    state: {
      oraclePriceRaw: "1", borrowRatePerSecondWad: "1", borrowAprWad: "31536000",
      totalSupplyAssetsRaw: "1000000000", totalSupplySharesRaw: "1000000000000000",
      totalBorrowAssetsRaw: "400000000", totalBorrowSharesRaw: "400000000000000",
      liquidityAssetsRaw: "600000000", feeWad: "100000000000000000", utilizationWad: "400000000000000000",
      supplyAprWad: "11352960", lastUpdateTimestamp: "1", ...overrides.state,
    },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "1000000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0", ...overrides.wallet },
    position: {
      supplySharesRaw: "100000000000000", suppliedAssetsRaw: "100000000", withdrawableSupplyAssetsRaw: "100000000",
      collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", availableBorrowAssetsRaw: "0", withdrawableCollateralRaw: "0",
      healthFactorWad: null, liquidationPriceRaw: null, ...overrides.position,
    },
  };
}

function rpc(simulations: Array<{ calls: readonly { data: `0x${string}` }[]; blockNumber: string; blockHash: string }>): MorphoMarketRpcReader {
  return {
    readSnapshot: async () => { throw new Error("unused"); },
    simulateBatch: async (calls, _owner, blockNumber, blockHash) => { simulations.push({ calls, blockNumber, blockHash }); },
  };
}

async function prepare(request: { marketId: typeof market.marketId; operation: "supply" | "withdraw" | "withdraw-all"; amountBaseUnits?: string }, state = snapshot(), ref: VerifiedMorphoMarketRef = market) {
  const simulations: Array<{ calls: readonly { data: `0x${string}` }[]; blockNumber: string; blockHash: string }> = [];
  const result = await prepareLendAction({ request, market: ref, owner: OWNER, snapshot: state, rpc: rpc(simulations), now: () => new Date("2026-09-14T12:00:00.000Z") });
  return { result, simulations };
}

describe("direct Morpho lending preparation", () => {
  test("supplies with an exact loan-token approval whenever allowance differs from the request", async () => {
    const { result, simulations } = await prepare({ marketId: market.marketId, operation: "supply", amountBaseUnits: "25000000" });
    expect(result.draft.kind).toBe("lend-supply");
    expect(result.draft.calls.map((call) => call.data.slice(0, 10))).toEqual(["0x095ea7b3", "0xa99aad89"]);
    expect(result.draft.calls[0]?.data.endsWith(BigInt("25000000").toString(16).padStart(64, "0"))).toBe(true);
    expect(result.draft.calls.every((call) => !call.data.endsWith("0".repeat(64)) || !call.data.startsWith("0x095ea7b3"))).toBe(true);
    expect(result.draft.expiresAt).toBe("2026-09-14T12:02:00.000Z");
    expect(simulations[0]).toMatchObject({ blockNumber: "100", blockHash: BLOCK_HASH });

    const exact = await prepare(
      { marketId: market.marketId, operation: "supply", amountBaseUnits: "25000000" },
      snapshot({ wallet: { loanAllowanceRaw: "25000000" } }),
    );
    expect(exact.result.draft.calls.map((call) => call.data.slice(0, 10))).toEqual(["0xa99aad89"]);

    const leftoverLargerAllowance = await prepare(
      { marketId: market.marketId, operation: "supply", amountBaseUnits: "25000000" },
      snapshot({ wallet: { loanAllowanceRaw: "25000001" } }),
    );
    expect(leftoverLargerAllowance.result.draft.calls.map((call) => call.data.slice(0, 10))).toEqual(["0x095ea7b3", "0xa99aad89"]);
    expect(leftoverLargerAllowance.result.draft.calls[0]?.data.endsWith(BigInt("25000000").toString(16).padStart(64, "0"))).toBe(true);
  });

  test("bounds exact withdrawal by both verified position and current liquidity", async () => {
    await expect(prepare({ marketId: market.marketId, operation: "withdraw", amountBaseUnits: "100000001" }))
      .rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(prepare(
      { marketId: market.marketId, operation: "withdraw", amountBaseUnits: "50000001" },
      snapshot({ state: { liquidityAssetsRaw: "50000000" }, position: { withdrawableSupplyAssetsRaw: "50000000" } }),
    )).rejects.toMatchObject({ code: "limit-exceeded" });
    const { result } = await prepare(
      { marketId: market.marketId, operation: "withdraw", amountBaseUnits: "50000000" },
      snapshot({ state: { liquidityAssetsRaw: "50000000" }, position: { withdrawableSupplyAssetsRaw: "50000000" } }),
    );
    expect(result.draft.calls[0]?.data.slice(0, 10)).toBe("0x5c2bea49");
  });

  test("withdraw-all is share-based and rejects an illiquid full-position claim", async () => {
    const { result } = await prepare({ marketId: market.marketId, operation: "withdraw-all" });
    const data = result.draft.calls[0]!.data;
    expect(data.slice(0, 10)).toBe("0x5c2bea49");
    expect(data).toContain(BigInt("100000000000000").toString(16).padStart(64, "0"));
    expect(result.draft.amounts[0]).toMatchObject({ amountBaseUnits: "100000000", direction: "receive", estimated: true });
    expect(result.draft.metadata).toMatchObject({ product: "lend", operation: "withdraw-all", supplySharesRaw: "100000000000000" });
    expect(result.draft.warnings).toContain("Morpho withdraws all current supply shares, so the received asset amount can change before submission.");

    const consumesLiquidity = await prepare(
      { marketId: market.marketId, operation: "withdraw-all" },
      snapshot({ state: { liquidityAssetsRaw: "100000000" }, position: { suppliedAssetsRaw: "100000000", withdrawableSupplyAssetsRaw: "100000000" } }),
    );
    expect(consumesLiquidity.result.draft.warnings).toContain("This review uses all currently indexed market liquidity; the call can fail if liquidity changes.");

    await expect(prepare(
      { marketId: market.marketId, operation: "withdraw-all" },
      snapshot({ state: { liquidityAssetsRaw: "99999999" }, position: { withdrawableSupplyAssetsRaw: "99999999" } }),
    )).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  test("fences preparation to the authenticated smart-account owner", async () => {
    await expect(prepareLendAction({
      request: { marketId: market.marketId, operation: "withdraw", amountBaseUnits: "1" },
      market,
      owner: "0x2222222222222222222222222222222222222222",
      snapshot: snapshot(),
      rpc: rpc([]),
    })).rejects.toMatchObject({ code: "invalid-input" });
  });

  test("fails closed when the exact pinned ordered batch does not simulate", async () => {
    await expect(prepareLendAction({
      request: { marketId: market.marketId, operation: "withdraw", amountBaseUnits: "1" },
      market,
      owner: OWNER,
      snapshot: snapshot(),
      rpc: {
        readSnapshot: async () => { throw new Error("unused"); },
        simulateBatch: async () => { throw new Error("reverted"); },
      },
    })).rejects.toMatchObject({ code: "simulation-failed" });
  });

  test("allows withdrawal but never new supply for reducing-only or absent lend capability", async () => {
    for (const capabilities of [{ borrow: "enabled", lend: "reducing-only" }, { borrow: "enabled" }] as MorphoMarketSnapshot["capabilities"][]) {
      const ref = { ...market, capabilities } as VerifiedMorphoMarketRef;
      const state = snapshot({ capabilities });
      await expect(prepare({ marketId: market.marketId, operation: "supply", amountBaseUnits: "1" }, state, ref))
        .rejects.toMatchObject({ code: "unsupported-market" });
      expect((await prepare({ marketId: market.marketId, operation: "withdraw", amountBaseUnits: "1" }, state, ref)).result.draft.kind)
        .toBe("lend-withdraw");
    }
    await expect(prepare(
      { marketId: market.marketId, operation: "withdraw", amountBaseUnits: "1" },
      snapshot({ position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableSupplyAssetsRaw: "0" } }),
    )).rejects.toMatchObject({ code: "limit-exceeded" });
  });
});
