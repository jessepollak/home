import "server-only";

import { generateKeyPairSync } from "node:crypto";
import { encodeFunctionData, erc20Abi } from "viem";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { MAX_MONEY_ACTION_AMOUNT_DECIMALS } from "@/shared/money-actions/types";
import { setActionsStoreForTests, type ActionsStore } from "@/server/actions/store";
import { issueMoneyAction, MoneyActionIssueError } from "./issue";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const CARD_SPENDER = "0x65bf8b55EEDef53C094E40003a03390De744DF33" as const;
const RETIRED_SPENDER = "0x3333333333333333333333333333333333333333" as const;
const cardEnv = ["BRIDGE_ENABLED", "BRIDGE_MODE", "BRIDGE_STRIPE_API_VERSION", "BRIDGE_WEBHOOK_PUBLIC_KEY", "BRIDGE_STRIPE_WEBHOOK_SECRET",
  "BRIDGE_PROGRAM_SPENDER", "BRIDGE_PROGRAM_RETIRED_SPENDERS", "BRIDGE_CARD_ALLOWANCE_MAX_USDC"] as const;
const priorCardEnv = Object.fromEntries(cardEnv.map((key) => [key, process.env[key]]));
function enableCardRegistry() {
  Object.assign(process.env, { BRIDGE_ENABLED: "1", BRIDGE_MODE: "production", BRIDGE_STRIPE_API_VERSION: "2026-08-27.basil",
    BRIDGE_WEBHOOK_PUBLIC_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString(),
    BRIDGE_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_private_fixture", BRIDGE_PROGRAM_SPENDER: CARD_SPENDER,
    BRIDGE_PROGRAM_RETIRED_SPENDERS: RETIRED_SPENDER, BRIDGE_CARD_ALLOWANCE_MAX_USDC: "100" });
}
function restoreCardRegistry() {
  for (const key of cardEnv) {
    const old = priorCardEnv[key];
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}
const NOW = new Date("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(NOW));
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
    expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
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

function reviewedQuote() {
  return {
    fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null },
    rate: null,
    receive: { amount: "2", currency: "USD", approximate: true },
    arrival: { source: "observed", kind: "within", seconds: 3600 },
  };
}

afterEach(() => { setActionsStoreForTests(null); setSystemTime(); restoreCardRegistry(); });

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

  test("keeps a reviewed quote that matches the recorded receive amount and timing", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    const draft = cashoutDraft("deposit");
    Object.assign(draft.metadata!, { etaSeconds: 3600, quote: reviewedQuote() });
    expect((await issueMoneyAction(session, draft)).metadata).toMatchObject({ quote: reviewedQuote() });
  });

  test.each([
    ["receive amount", { receive: { amount: "3", currency: "USD", approximate: true } }],
    ["receive currency", { receive: { amount: "2", currency: "GBP", approximate: true } }],
    ["arrival", { arrival: { source: "unknown" } }],
    ["operator fee", { fees: { provider: null, network: null, operator: { amount: "1", currency: "USD" } } }],
    ["shape", { rate: { from: "USDC", to: "USD", value: "-1" } }],
  ])("rejects a quote whose %s disagrees with the reviewed record", async (_label, override) => {
    const draft = cashoutDraft("deposit");
    Object.assign(draft.metadata!, { etaSeconds: 3600, quote: { ...reviewedQuote(), ...override } });
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });

  test("rejects a quote on withdrawal metadata", async () => {
    const draft = cashoutDraft("withdraw");
    Object.assign(draft.metadata!, { etaSeconds: 3600, quote: reviewedQuote() });
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

  test("accepts the shared amount decimal bound and rejects amounts beyond it", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    const draft = savingsDraft("deposit");
    if (draft.metadata?.product !== "savings") throw new Error("Expected savings metadata");
    draft.metadata.shareDecimals = MAX_MONEY_ACTION_AMOUNT_DECIMALS;
    draft.amounts[1]!.decimals = MAX_MONEY_ACTION_AMOUNT_DECIMALS;
    expect((await issueMoneyAction(session, draft)).amounts[1]?.decimals).toBe(MAX_MONEY_ACTION_AMOUNT_DECIMALS);
    const beyond = savingsDraft("deposit");
    beyond.amounts[1]!.decimals = MAX_MONEY_ACTION_AMOUNT_DECIMALS + 1;
    await expect(issueMoneyAction(session, beyond)).rejects.toMatchObject({ reason: "invalid-draft" });
  });

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

  test("rejects malformed paymaster approval calldata and spender as an invalid draft", async () => {
    const approval = makePaymasterApproval(BigInt(100000));
    const nonHexAmount: MoneyActionDraft["calls"][number] = { ...approval, data: `0x${approval.data.slice(2, 74)}${"z".repeat(64)}` };
    const malformed = [
      nonHexAmount,
      { ...approval, ...JSON.parse('{"data":1}') },
      { ...approval, ...JSON.parse('{"approval":{"assetId":"usdc","spender":1}}') },
    ];
    for (const call of malformed) {
      const draft = savingsDraft("deposit");
      draft.calls.unshift(call);
      draft.networkFee = { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 };
      await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
    }
  });
});

function cardDraft(operation: "set-allowance" | "revoke-allowance" = "set-allowance", spender: `0x${string}` = CARD_SPENDER, amount = "25000000"): MoneyActionDraft {
  const set = operation === "set-allowance";
  return { kind: "card-allowance", title: set ? "Set card spending limit" : "Remove card spending permission", amounts: [],
    warnings: [`Card program spender: ${spender}`], expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    calls: [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, BigInt(set ? amount : "0")] }),
      value: "0", approval: { assetId: "usdc", spender: spender as `0x${string}` } }],
    metadata: { product: "card", operation, provider: "bridge", mode: "production", token: BASE_USDC_ADDRESS.toLowerCase() as `0x${string}`,
      spender: spender.toLowerCase() as `0x${string}`, allowanceBaseUnits: set ? amount : "0", previousAllowanceBaseUnits: "5000000",
      maximumBaseUnits: set ? "100000000" : null, source: { blockNumber: "51026404" } } };
}

describe("bounded card allowance issuance", () => {
  beforeEach(() => { enableCardRegistry(); setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore); });
  test("malformed retired spender registry leaves unrelated savings approvals issuable but rejects card allowances", async () => {
    process.env.BRIDGE_PROGRAM_RETIRED_SPENDERS = "not-an-address";
    const savings = savingsDraft("deposit");
    savings.warnings = [];
    savings.calls.unshift(makePaymasterApproval(BigInt(100000)));
    savings.networkFee = { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 };
    expect((await issueMoneyAction(session, savings)).kind).toBe("savings-deposit");
    await expect(issueMoneyAction(session, cardDraft())).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test.each(["send", "savings-deposit"] as const)("rejects current spender approval in %s with malformed retired registry", async (kind) => {
    process.env.BRIDGE_PROGRAM_RETIRED_SPENDERS = "invalid,";
    const draft = savingsDraft("deposit");
    draft.kind = kind;
    if (kind === "send") draft.metadata = undefined;
    draft.calls.unshift(cardDraft().calls[0]!);
    draft.amounts[0]!.amountBaseUnits = "25000000";
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("blocks current spender even when Bridge is disabled", async () => {
    delete process.env.BRIDGE_ENABLED;
    const draft = savingsDraft("deposit");
    draft.calls.unshift(cardDraft().calls[0]!);
    draft.amounts[0]!.amountBaseUnits = "25000000";
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("issues a finite set and a standalone zero revoke, including a retired spender", async () => {
    expect((await issueMoneyAction(session, cardDraft())).amounts).toEqual([]);
    expect((await issueMoneyAction(session, cardDraft("revoke-allowance"))).calls).toHaveLength(1);
    expect((await issueMoneyAction(session, cardDraft("revoke-allowance", RETIRED_SPENDER))).metadata).toMatchObject({ operation: "revoke-allowance", allowanceBaseUnits: "0" });
  });
  test("accepts exactly the optional paymaster prefix", async () => {
    const draft = cardDraft();
    draft.calls.unshift(makePaymasterApproval(BigInt(100000)));
    draft.networkFee = { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 };
    expect((await issueMoneyAction(session, draft)).calls).toHaveLength(2);
  });
  test.each(["0", "100000001", ((BigInt(1) << BigInt(256)) - BigInt(1)).toString()])("rejects set amount %s outside cap", async (amount) => {
    await expect(issueMoneyAction(session, cardDraft("set-allowance", CARD_SPENDER, amount))).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("rejects a stale maximum, a retired set, and an unknown revoke", async () => {
    const stale = cardDraft();
    if (stale.metadata?.product !== "card") throw new Error("Missing card metadata");
    stale.metadata.maximumBaseUnits = "200000000";
    for (const draft of [stale, cardDraft("set-allowance", RETIRED_SPENDER), cardDraft("revoke-allowance", VAULT)]) {
      await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
    }
  });
  test("rejects extra calls, wrong token, altered calldata, and wrong approval spender", async () => {
    const extra = cardDraft(); extra.calls.push({ to: VAULT, data: "0x1234", value: "0" });
    const token = cardDraft(); token.calls[0]!.to = VAULT;
    const calldata = cardDraft(); calldata.calls[0]!.data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CARD_SPENDER, BigInt(1000000)] });
    const spender = cardDraft(); spender.calls[0]!.approval!.spender = VAULT;
    for (const draft of [extra, token, calldata, spender]) await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("rejects metadata on another kind, and card kind without card metadata", async () => {
    const wrongKind = cardDraft(); wrongKind.kind = "send";
    const noMetadata = cardDraft(); delete noMetadata.metadata;
    const wrongMetadata = cardDraft(); wrongMetadata.metadata = savingsDraft("deposit").metadata;
    for (const draft of [wrongKind, noMetadata, wrongMetadata]) await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("rejects a retired card spender in an otherwise exact send approval", async () => {
    const draft = savingsDraft("deposit");
    draft.kind = "send";
    draft.metadata = undefined;
    draft.calls.unshift(cardDraft("set-allowance", RETIRED_SPENDER).calls[0]!);
    draft.amounts[0]!.amountBaseUnits = "25000000";
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test.each(["send", "trade", "savings-deposit"] as const)("rejects a card spender approval in %s", async (kind) => {
    const draft = savingsDraft("deposit");
    draft.kind = kind;
    draft.metadata = kind === "savings-deposit" ? draft.metadata : undefined;
    const approval = cardDraft().calls[0]!;
    draft.calls.unshift(approval);
    draft.amounts[0]!.amountBaseUnits = "25000000";
    await expect(issueMoneyAction(session, draft)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
});
