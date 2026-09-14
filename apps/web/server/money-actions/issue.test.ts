import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { setActionsStoreForTests, type ActionsStore } from "@/server/actions/store";
import { issueMoneyAction } from "./issue";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const MARKET_ID = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as const;
const session: VerifiedAccountSession = {
  user: { subject: "issue-test" },
  smartAccount: { address: OWNER, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

afterEach(() => setActionsStoreForTests(null));

function baseDraft(): MoneyActionDraft {
  return {
    kind: "lend-supply",
    title: "Supply USDC",
    calls: [{ to: OWNER, data: "0x12", value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
    warnings: ["Variable rate."],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    metadata: {
      product: "lend",
      operation: "supply",
      marketId: MARKET_ID,
      loanAsset: { id: "usdc", symbol: "USDC" },
      supplySharesRaw: "0",
      suppliedAssetsRaw: "0",
      withdrawableAssetsRaw: "0",
      supplyAprWad: "0",
      source: { blockNumber: "1", blockHash: BLOCK_HASH, blockTimestamp: "1" },
    },
  };
}

function noWriteStore() {
  return { insert: async () => { throw new Error("invalid metadata must not reach storage"); } } as unknown as ActionsStore;
}

describe("money action metadata authority", () => {
  test.each(["supplySharesRaw", "suppliedAssetsRaw", "withdrawableAssetsRaw", "supplyAprWad"] as const)(
    "rejects non-string Lend integer metadata at %s",
    async (field) => {
      setActionsStoreForTests(noWriteStore());
      const draft = baseDraft();
      (draft.metadata as unknown as Record<string, unknown>)[field] = 1;
      await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
    },
  );

  test("rejects non-string Borrow APR metadata before applying the integer regex", async () => {
    setActionsStoreForTests(noWriteStore());
    const draft = baseDraft();
    draft.kind = "borrow";
    draft.metadata = {
      product: "borrow",
      operation: "borrow",
      marketId: MARKET_ID,
      loanAsset: { id: "usdc", symbol: "USDC" },
      collateralAsset: { id: "cbbtc", symbol: "cbBTC" },
      projectedHealthFactorWad: null,
      projectedLiquidationPriceRaw: null,
      borrowAprWad: 1 as unknown as string,
      source: { blockNumber: "1", blockHash: BLOCK_HASH, blockTimestamp: "1" },
    };
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
});
