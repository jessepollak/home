import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/types";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { BorrowExperience } = await import("./borrowing-experience");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

const session: VerifiedAccountSession = {
  user: { subject: "borrow-ui-user" },
  smartAccount: { address: OWNER, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function emptySnapshot(): BorrowMarketSnapshot {
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
      oraclePriceRaw: "800000000000000000000000000000000000000", borrowRatePerSecondWad: "1000000000",
      borrowAprWad: "31536000000000000", totalSupplyAssetsRaw: "1000000000", totalBorrowAssetsRaw: "500000000",
      totalBorrowSharesRaw: "500000000", liquidityAssetsRaw: "500000000", lastUpdateTimestamp: "1788897500",
    },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "0", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: {
      collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", borrowCapacityAssetsRaw: "0",
      withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null,
    },
  };
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("BorrowExperience", () => {
  test("shows the single verified market while keeping a signed-out wallet truly empty", () => {
    render(<BorrowExperience session={null} />);
    expect(within(document.body).getByRole("heading", { level: 1, name: "USDC against cbBTC" })).toBeTruthy();
    expect(within(document.body).getByText(/Sign in to view this wallet’s position/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Demo balance");
  });

  test("loads private state and sends only user intent to the unified prepare action", async () => {
    const snapshot = emptySnapshot();
    const reads: string[] = [];
    const prepared: Array<{ kind: string; params: unknown }> = [];
    const fetchAccountResource = async (path: string) => {
      reads.push(path);
      return snapshot;
    };
    const prepareMoneyAction = async (kind: string, params: unknown) => {
      prepared.push({ kind, params });
      return {
        id: "11111111-1111-4111-8111-111111111111",
        owner: { subject: session.user.subject, address: OWNER, chainId: 8453 as const, accountProvider: "cdp-embedded" as const },
        kind: "borrow" as const,
        title: "Borrow USDC",
        calls: [{ to: MORPHO_BLUE_ADDRESS, data: "0x1234" as const, value: "0" }],
        amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" as const }],
        warnings: ["Current state only."],
        createdAt: "2026-09-12T12:00:00.000Z",
        expiresAt: "2030-09-12T12:02:00.000Z",
      };
    };

    render(<BorrowExperience session={session} fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    expect(await within(document.body).findByRole("button", { name: "Refresh" })).toBeTruthy();
    fireEvent.change(within(document.body).getByLabelText("Action"), { target: { value: "borrow" } });
    fireEvent.change(within(document.body).getByLabelText("Amount (USDC)"), { target: { value: "1" } });
    const previewButton = within(document.body).getByRole("button", { name: "Review current preview" });
    fireEvent.click(previewButton);
    expect(await within(document.body).findByText("Borrow USDC")).toBeTruthy();
    expect(reads).toEqual(["/api/borrow"]);
    expect(prepared).toEqual([{
      kind: "borrow",
      params: { operation: "borrow", amount: "1", snapshotBlockHash: BLOCK_HASH },
    }]);
    expect(JSON.stringify(prepared)).not.toContain("calls");
  });
});
