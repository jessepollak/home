import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/server/borrowing/config";
import type { BorrowMarketSnapshot } from "@/server/borrowing/types";

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

afterEach(cleanup);

describe("BorrowExperience", () => {
  test("shows the single verified market while keeping a signed-out wallet truly empty", () => {
    render(<BorrowExperience session={null} />);
    const title = within(document.body).getByRole("heading", { level: 1, name: "USDC against cbBTC" });
    expect(title.classList.contains("home-ui-text")).toBe(true);
    expect(title.getAttribute("data-text-style")).toBe("page-title");
    expect(within(document.body).getByText(/Sign in to view this wallet’s position/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Demo balance");
  });

  test("loads private state through fetchAccountResource and sends only user intent to the prepare endpoint", async () => {
    const snapshot = emptySnapshot();
    const requests: Array<{ path: string; options: unknown }> = [];
    const fetchAccountResource = async (path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}) => {
      requests.push({ path, options });
      if (options.method === "POST") {
        return {
          status: "preview-only",
          snapshot,
          preview: {
            operation: "borrow",
            title: "Borrow USDC",
            amount: { symbol: "USDC", decimals: 6, amountBaseUnits: "1000000" },
            warnings: ["Current state only."],
            asOf: "2026-09-08T12:00:00.000Z",
            execution: "disabled",
            disabledReason: "Simulation unavailable.",
          },
        };
      }
      return snapshot;
    };

    render(<BorrowExperience session={session} fetchAccountResource={fetchAccountResource} />);
    expect(await within(document.body).findByText(/no cbBTC, USDC, or position/i)).toBeTruthy();
    const refreshButton = within(document.body).getByRole("button", { name: "Refresh" });
    expect(refreshButton.classList.contains("home-ui-button")).toBe(true);
    expect(refreshButton.getAttribute("data-variant")).toBe("secondary");
    fireEvent.change(within(document.body).getByLabelText("Action"), { target: { value: "borrow" } });
    fireEvent.change(within(document.body).getByLabelText("Amount (USDC)"), { target: { value: "1" } });
    const previewButton = within(document.body).getByRole("button", { name: "Review current preview" });
    expect(previewButton.classList.contains("home-ui-button")).toBe(true);
    expect(previewButton.getAttribute("data-variant")).toBe("primary");
    fireEvent.click(previewButton);
    expect(await within(document.body).findByText("Read-only preview")).toBeTruthy();
    expect(within(document.body).getByText("1 USDC").getAttribute("data-text-style")).toBe("row-value");

    expect(requests[0].path).toBe("/api/borrow");
    expect(requests[1]).toEqual({
      path: "/api/borrow",
      options: {
        method: "POST",
        body: { operation: "borrow", amount: "1", snapshotBlockHash: BLOCK_HASH },
      },
    });
    expect(JSON.stringify(requests[1])).not.toContain("calls");
  });
});
