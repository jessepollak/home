import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import { createBorrowHandlers } from "./handler";
import { ORACLE_PRICE_SCALE } from "./math";
import type { BorrowRpcReader } from "./rpc";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/types";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

function session(): VerifiedAccountSession {
  return {
    user: { subject: "borrow-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function snapshot(collateralAllowance = "0"): BorrowMarketSnapshot {
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
      collateralAllowanceRaw: collateralAllowance, loanAllowanceRaw: "0",
    },
    position: {
      collateralRaw: "1000000", borrowSharesRaw: "100000000", debtAssetsRaw: "100000000",
      borrowCapacityAssetsRaw: "500000000", withdrawableCollateralRaw: "800000",
      healthFactorWad: "6880000000000000000", liquidationPriceRaw: "116279069767441860465116279069767441861",
    },
  };
}

function request(body: unknown, method = "POST") {
  return new Request("https://home.test/api/borrow", {
    method,
    headers: {
      [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function dependencies(current: BorrowMarketSnapshot) {
  let issued = 0;
  const rpc: BorrowRpcReader = {
    readSnapshot: async () => current,
    simulateBatch: async () => {},
  };
  const handlers = createBorrowHandlers({
    authorize: async () => Response.json(session()),
    rpc,
    issueAction: async (verifiedSession, draft) => {
      issued += 1;
      return {
        ...draft,
        id: "prepared-borrow",
        reviewHash: "review-hash",
        owner: {
          subject: verifiedSession.user.subject,
          address: verifiedSession.smartAccount!.address,
          chainId: 8453,
          accountProvider: verifiedSession.accountProvider,
        },
        createdAt: "2026-09-08T12:00:00.000Z",
      } satisfies PreparedMoneyAction;
    },
  });
  return { handlers, issued: () => issued };
}

describe("borrow API handlers", () => {
  test("issues a server-built, simulated borrow action for the verified owner", async () => {
    const fixture = dependencies(snapshot());
    const response = await fixture.handlers.POST(request({
      operation: "borrow",
      amount: "10",
      snapshotBlockHash: BLOCK_HASH,
    }));
    const value = await response.json();

    expect(response.status).toBe(201);
    expect(value.status).toBe("prepared");
    expect(value.action.kind).toBe("borrow");
    expect(value.action.owner.address).toBe(OWNER);
    expect(fixture.issued()).toBe(1);
  });

  test("issues first-use supply after simulating its ordered approval and Morpho call as one batch", async () => {
    const fixture = dependencies(snapshot("0"));
    const response = await fixture.handlers.POST(request({
      operation: "supply-collateral",
      amount: "0.01",
      snapshotBlockHash: BLOCK_HASH,
    }));
    const value = await response.json();

    expect(response.status).toBe(201);
    expect(value.status).toBe("prepared");
    expect(value.action.calls).toHaveLength(2);
    expect(fixture.issued()).toBe(1);
  });

  test("relays authentication failure without reading market state", async () => {
    let reads = 0;
    const handlers = createBorrowHandlers({
      authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
      rpc: {
        readSnapshot: async () => { reads += 1; return snapshot(); },
        simulateBatch: async () => {},
      },
    });
    const response = await handlers.GET(request(undefined, "GET"));
    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });
});
