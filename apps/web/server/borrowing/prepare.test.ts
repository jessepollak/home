import { describe, expect, test } from "bun:test";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import { ORACLE_PRICE_SCALE } from "./math";
import { BorrowPreparationError, prepareBorrowAction } from "./prepare";
import type { BorrowRpcReader } from "./rpc";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/types";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;

function snapshot(overrides: Partial<BorrowMarketSnapshot["position"]> = {}, walletOverrides: Partial<BorrowMarketSnapshot["wallet"]> = {}): BorrowMarketSnapshot {
  const oraclePrice = BigInt("80000") * ORACLE_PRICE_SCALE * BigInt("1000000") / BigInt("100000000");
  return {
    chainId: 8453,
    walletAddress: OWNER,
    market: {
      id: BORROW_MARKET_ID,
      morpho: MORPHO_BLUE_ADDRESS,
      loanToken: BORROW_LOAN_TOKEN,
      collateralToken: BORROW_COLLATERAL_TOKEN,
      oracle: BORROW_ORACLE_ADDRESS,
      irm: BORROW_IRM_ADDRESS,
      lltvWad: BORROW_LLTV_WAD.toString(),
    },
    source: {
      provider: "Base JSON-RPC",
      blockNumber: "100",
      blockHash: BLOCK_HASH,
      blockTimestamp: "1788897600",
      fetchedAt: "2026-09-08T12:00:00.000Z",
    },
    state: {
      oraclePriceRaw: oraclePrice.toString(),
      borrowRatePerSecondWad: "1000000000",
      borrowAprWad: "31536000000000000",
      totalSupplyAssetsRaw: "1000000000000",
      totalBorrowAssetsRaw: "500000000000",
      totalBorrowSharesRaw: "500000000000",
      liquidityAssetsRaw: "500000000000",
      lastUpdateTimestamp: "1788897500",
    },
    wallet: {
      collateralBalanceRaw: "10000000",
      loanBalanceRaw: "1000000000",
      collateralAllowanceRaw: "0",
      loanAllowanceRaw: "0",
      ...walletOverrides,
    },
    position: {
      collateralRaw: "1000000",
      borrowSharesRaw: "100000000",
      debtAssetsRaw: "100000000",
      borrowCapacityAssetsRaw: "500000000",
      withdrawableCollateralRaw: "800000",
      healthFactorWad: "6880000000000000000",
      liquidationPriceRaw: "116279069767441860465116279069767441861",
      ...overrides,
    },
  };
}

function rpcFixture() {
  const batches: Array<{
    calls: Array<{ to: string; data: string; approval?: { assetId: string; spender: string } }>;
    blockHash: string;
  }> = [];
  const rpc: BorrowRpcReader = {
    readSnapshot: async () => snapshot(),
    simulateBatch: async (calls, _account, _blockNumber, blockHash) => {
      batches.push({ calls: calls.map((call) => {
        const approval = (call as typeof call & { approval?: { assetId: string; spender: string } }).approval;
        return {
          to: call.to,
          data: call.data,
          ...(approval ? { approval } : {}),
        };
      }), blockHash });
    },
  };
  return { rpc, batches };
}

describe("borrow action preparation", () => {
  test("builds a simulated borrow whose onBehalf and receiver are the verified wallet", async () => {
    const fixture = rpcFixture();
    const prepared = await prepareBorrowAction({
      request: { operation: "borrow", amount: "25", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });

    expect(prepared.fullySimulated).toBe(true);
    expect(prepared.draft.kind).toBe("borrow");
    expect(prepared.draft.calls).toHaveLength(1);
    expect(prepared.draft.calls[0].to).toBe(MORPHO_BLUE_ADDRESS);
    expect(prepared.draft.calls[0].data.startsWith("0x50d8cd4b")).toBe(true);
    const ownerWord = OWNER.slice(2).padStart(64, "0");
    expect(prepared.draft.calls[0].data.endsWith(`${ownerWord}${ownerWord}`)).toBe(true);
    expect(prepared.draft.expiresAt).toBe("2026-09-08T12:02:00.000Z");
    expect(fixture.batches).toHaveLength(1);
    expect(fixture.batches[0].calls).toHaveLength(1);
    expect(fixture.batches[0].blockHash).toBe(BLOCK_HASH);
  });

  test("simulates first-use approval and supply together in one Coinbase smart-account batch", async () => {
    const fixture = rpcFixture();
    const prepared = await prepareBorrowAction({
      request: { operation: "supply-collateral", amount: "0.01", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    });

    expect(prepared.draft.calls).toHaveLength(2);
    expect(prepared.draft.calls[0].to).toBe(BORROW_COLLATERAL_TOKEN.address);
    expect(prepared.draft.calls[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(prepared.draft.calls[0].data.endsWith((BigInt("1000000")).toString(16).padStart(64, "0"))).toBe(true);
    expect((prepared.draft.calls[0] as typeof prepared.draft.calls[number] & { approval?: unknown }).approval).toEqual({
      assetId: BORROW_COLLATERAL_TOKEN.id,
      spender: MORPHO_BLUE_ADDRESS,
    });
    expect(prepared.fullySimulated).toBe(true);
    expect(prepared.simulationGap).toBeNull();
    expect(fixture.batches).toHaveLength(1);
    expect(fixture.batches[0].calls).toHaveLength(2);
  });

  test("simulates approval and partial repay together when current allowance differs from the exact amount", async () => {
    const fixture = rpcFixture();
    const prepared = await prepareBorrowAction({
      request: { operation: "repay", amount: "10", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot({}, { loanAllowanceRaw: "20000000" }),
      rpc: fixture.rpc,
    });

    expect(prepared.draft.calls).toHaveLength(2);
    expect(prepared.draft.calls[0].data.endsWith((BigInt("10000000")).toString(16).padStart(64, "0"))).toBe(true);
    expect(prepared.fullySimulated).toBe(true);
    expect(fixture.batches).toHaveLength(1);
    expect(fixture.batches[0].calls).toHaveLength(2);
  });

  test("repays all current borrow shares with a finite wallet-bounded maximum and separate estimate", async () => {
    const fixture = rpcFixture();
    const prepared = await prepareBorrowAction({
      request: { operation: "repay-all", amount: "125", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    });

    expect(prepared.draft.kind).toBe("repay");
    expect(prepared.draft.calls).toHaveLength(2);
    expect((prepared.draft.calls[0] as typeof prepared.draft.calls[number] & { approval?: unknown }).approval).toEqual({
      assetId: BORROW_LOAN_TOKEN.id,
      spender: MORPHO_BLUE_ADDRESS,
    });
    const repayData = prepared.draft.calls[1].data;
    expect(repayData.startsWith("0x20b76e81")).toBe(true);
    const words = repayData.slice(10).match(/.{64}/g)!;
    expect(BigInt(`0x${words[5]}`)).toBe(BigInt("0"));
    expect(BigInt(`0x${words[6]}`)).toBe(BigInt("100000000"));
    expect(`0x${words[7].slice(24)}`).toBe(OWNER);
    expect(BigInt(`0x${words[8]}`)).toBe(BigInt("288"));
    expect(BigInt(`0x${words[9]}`)).toBe(BigInt("0"));
    expect(prepared.draft.amounts).toEqual([
      expect.objectContaining({ amountBaseUnits: "100000000", estimated: true }),
      expect.objectContaining({ amountBaseUnits: "125000000", maximum: true }),
    ]);
    expect(fixture.batches[0].calls).toHaveLength(2);
  });

  test("rejects repay-all caps below current debt or above the verified wallet balance", async () => {
    const fixture = rpcFixture();
    await expect(prepareBorrowAction({
      request: { operation: "repay-all", amount: "99", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    })).rejects.toThrow("must cover the current estimated");
    await expect(prepareBorrowAction({
      request: { operation: "repay-all", amount: "1000.000001", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    })).rejects.toThrow("cannot exceed");
    expect(fixture.batches).toHaveLength(0);
  });

  test("rejects current capacity overruns and routes full repayment to the explicit capped path", async () => {
    const fixture = rpcFixture();
    await expect(prepareBorrowAction({
      request: { operation: "borrow", amount: "500.000001", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    })).rejects.toBeInstanceOf(BorrowPreparationError);

    await expect(prepareBorrowAction({
      request: { operation: "repay", amount: "100", snapshotBlockHash: BLOCK_HASH },
      snapshot: snapshot(),
      rpc: fixture.rpc,
    })).rejects.toThrow("choose Repay all");
    expect(fixture.batches).toHaveLength(0);
  });
});
