import "server-only";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { setActionsStoreForTests, type ActionsStore } from "@/server/actions/store";
import { issueMoneyAction, MoneyActionIssueError } from "./issue";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function savingsDraft(operation: "deposit" | "withdraw"): MoneyActionDraft {
  const deposit = operation === "deposit";
  return {
    kind: deposit ? "savings-deposit" : "savings-withdraw",
    title: deposit ? "Deposit USDC" : "Withdraw USDC",
    calls: [{ to: VAULT, data: "0x1234", value: "0" }],
    amounts: [
      {
        assetId: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "1000000",
        direction: deposit ? "spend" : "receive",
      },
      {
        assetId: `eip155:8453/erc20:${VAULT}`,
        symbol: "vault shares",
        decimals: 18,
        amountBaseUnits: "1000000000000000000",
        direction: deposit ? "receive" : "spend",
        estimated: true,
      },
    ],
    warnings: ["The wallet shows the Base network fee."],
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    metadata: {
      product: "savings",
      operation,
      vaultAddress: VAULT,
      vaultName: "Configured USDC vault",
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "500000000",
      previewSharesBaseUnits: "1000000000000000000",
      shareDecimals: 18,
      exchangeConstraint: deposit
        ? "deposit-minimum-shares-or-revert"
        : "withdraw-exact-assets-or-revert",
      ...(deposit ? { minimumSharesBaseUnits: "999000000000000000" } : {}),
      discoveryRate: {
        status: "current",
        netApy: "0.04",
        fetchedAt: "2026-09-12T12:00:01.000Z",
        stateAsOf: "2026-09-12T12:00:00.000Z",
      },
      source: {
        blockNumber: "51026404",
        blockHash: `0x${"AB".repeat(32)}`,
        blockTimestamp: "1789214400",
      },
    },
  };
}

function cashoutDraft(operation: "deposit" | "withdraw"): MoneyActionDraft {
  return {
    ...savingsDraft("deposit"),
    kind: operation === "deposit" ? "cash-out" : "cash-out-withdraw",
    metadata: {
      product: "cashout", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "2",
      minConversionRate: "1", intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: "2026-09-12T12:00:00.000Z", escrow: VAULT,
      ...(operation === "deposit" ? { operation: "deposit" as const, canonicalHandle: "Alice", payeeHash: `0x${"AB".repeat(32)}` as const } :
        { operation: "withdraw" as const, depositId: "escrow_7" }),
    },
  };
}

afterEach(() => setActionsStoreForTests(null));

describe("cash-out money action issuance", () => {
  test("normalizes the reviewed deposit payee hash and accepts legacy drafts without it", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    const action = await issueMoneyAction(session, cashoutDraft("deposit"));
    expect(action.metadata).toMatchObject({ payeeHash: `0x${"ab".repeat(32)}` });
    const legacy = cashoutDraft("deposit");
    if (legacy.metadata?.product !== "cashout" || legacy.metadata.operation !== "deposit") throw new Error("Expected deposit");
    delete legacy.metadata.payeeHash;
    expect((await issueMoneyAction(session, legacy)).metadata).not.toHaveProperty("payeeHash");
  });

  test.each(["invalid", `0x${"ab".repeat(31)}`])("rejects invalid deposit payee hash %s", async (payeeHash) => {
    const draft = cashoutDraft("deposit");
    if (draft.metadata?.product !== "cashout" || draft.metadata.operation !== "deposit") throw new Error("Expected deposit");
    draft.metadata.payeeHash = payeeHash as `0x${string}`;
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });

  test("rejects a payee hash on withdrawal metadata", async () => {
    const draft = cashoutDraft("withdraw");
    Object.assign(draft.metadata!, { payeeHash: `0x${"ab".repeat(32)}` });
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
});

describe("savings money action issuance", () => {
  test.each(["deposit", "withdraw"] as const)(
    "issues a validated savings %s draft and stores typed review metadata",
    async (operation) => {
      const inserts: Array<Parameters<ActionsStore["insert"]>[0]> = [];
      setActionsStoreForTests({
        insert: async (input: Parameters<ActionsStore["insert"]>[0]) => {
          inserts.push(input);
        },
      } as ActionsStore);

      const action = await issueMoneyAction(session, savingsDraft(operation));

      expect(action).toMatchObject({
        kind: operation === "deposit" ? "savings-deposit" : "savings-withdraw",
        metadata: {
          product: "savings",
          operation,
          vaultAddress: VAULT,
          source: { blockHash: `0x${"ab".repeat(32)}` },
        },
      });
      expect(action.metadata?.product === "savings" ? action.metadata.minimumSharesBaseUnits : undefined)
        .toBe(operation === "deposit" ? "999000000000000000" : undefined);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.summary.metadata).toEqual(action.metadata);
    },
  );

  test("rejects a legacy deposit draft while preserving stored legacy metadata elsewhere", async () => {
    const draft = savingsDraft("deposit");
    if (draft.metadata?.product !== "savings") throw new Error("Expected savings metadata");
    draft.metadata.exchangeConstraint = "deposit-preview-no-minimum-shares";
    delete draft.metadata.minimumSharesBaseUnits;
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({
      reason: "invalid-draft",
    } satisfies Partial<MoneyActionIssueError>);
  });

  test("rejects savings metadata whose operation disagrees with the action kind", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    const draft = savingsDraft("deposit");
    draft.kind = "savings-withdraw";

    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({
      reason: "invalid-draft",
    } satisfies Partial<MoneyActionIssueError>);
  });

  test("stores an exact first-call network fee approval without a native fee warning", async () => {
    const inserts: Array<Parameters<ActionsStore["insert"]>[0]> = [];
    setActionsStoreForTests({ insert: async (input: Parameters<ActionsStore["insert"]>[0]) => { inserts.push(input); } } as ActionsStore);
    const draft = savingsDraft("deposit");
    draft.warnings = [];
    draft.calls.unshift(makePaymasterApproval(BigInt(100000)));
    draft.networkFee = { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 };
    const action = await issueMoneyAction(session, draft);
    expect(action.warnings).toEqual([]);
    expect(action.networkFee).toEqual(draft.networkFee);
    expect(inserts[0]?.summary.networkFee).toEqual(action.networkFee);
  });

  test("rejects an approval higher than the per-action approved network fee", async () => {
    const draft = savingsDraft("deposit");
    draft.calls.unshift(makePaymasterApproval(BigInt(100001)));
    draft.networkFee = { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 };
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
});
