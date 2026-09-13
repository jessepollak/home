import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { createBorrowHandler } from "./handler";
import { ORACLE_PRICE_SCALE } from "./math";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

function session(): VerifiedAccountSession {
  return {
    user: { subject: "borrow-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function snapshot(): BorrowMarketSnapshot {
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
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1788897600", fetchedAt: "2026-09-08T12:00:00.000Z" },
    state: {
      oraclePriceRaw: oraclePrice.toString(), borrowRatePerSecondWad: "0", borrowAprWad: "0",
      totalSupplyAssetsRaw: "2000000000", totalBorrowAssetsRaw: "500000000", totalBorrowSharesRaw: "500000000",
      liquidityAssetsRaw: "1500000000", lastUpdateTimestamp: "1788897600",
    },
    wallet: {
      collateralBalanceRaw: "10000000", loanBalanceRaw: "1000000000",
      collateralAllowanceRaw: "0", loanAllowanceRaw: "0",
    },
    position: {
      collateralRaw: "1000000", borrowSharesRaw: "100000000", debtAssetsRaw: "100000000",
      borrowCapacityAssetsRaw: "500000000", withdrawableCollateralRaw: "800000",
      healthFactorWad: "6880000000000000000", liquidationPriceRaw: "116279069767441860465116279069767441861",
    },
  };
}

function request() {
  return new Request("https://home.test/api/borrow", {
    headers: { [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
  });
}

describe("borrow API handler", () => {
  test("returns the current borrowing snapshot for the verified owner", async () => {
    const handler = createBorrowHandler({
      authorize: async () => Response.json(session()),
      rpc: { readSnapshot: async () => snapshot(), simulateBatch: async () => {} },
    });

    const response = await handler(request());
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(value.walletAddress).toBe(OWNER);
  });

  test("relays authentication failure without reading market state", async () => {
    let reads = 0;
    const handler = createBorrowHandler({
      authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
      rpc: {
        readSnapshot: async () => { reads += 1; return snapshot(); },
        simulateBatch: async () => {},
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });

  test("maps snapshot failures to the private unavailable response", async () => {
    const handler = createBorrowHandler({
      authorize: async () => Response.json(session()),
      rpc: {
        readSnapshot: async () => { throw new Error("rpc unavailable"); },
        simulateBatch: async () => {},
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "BORROW_STATE_UNAVAILABLE",
        message: "Current Morpho position, oracle, liquidity, or limit state is unavailable.",
      },
    });
  });
});
