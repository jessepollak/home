import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import { finalizeTradeAction, createTradePreclaimValidator } from "./finalize";
import { hashTypedData } from "viem";
import { MemoryTradeIntentStore } from "./intent-store";
import { createCoinbaseSmartWalletTypedData, PERMIT2_ADDRESS } from "./permit2";
import type { TradeIntent } from "./types";

const SMART = "0x3333333333333333333333333333333333333333" as const;
const SIGNER = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const PERMIT_HASH = "0x6aef4defc6f866dcc2b2060a5d39fafd8960060ee1489b6a7da0b0fb2672904a" as const;
const SIGNATURE = "0x19e12082d8287f5b8674ea630bd00259c5818f0eb60a214e6d2cafc62a8f194a506c931af122a2f6e07392c88a05385a14bce841fdb3e80e186ba7640423f8fc1b" as const;
const NOW = "2026-09-08T04:00:00.000Z";

const session: VerifiedAccountSession = {
  user: { subject: "trade-user" },
  smartAccount: { address: SMART, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function intent(): TradeIntent {
  const signingTypedData = createCoinbaseSmartWalletTypedData(SMART, PERMIT_HASH);
  expect(hashTypedData(signingTypedData as unknown as Parameters<typeof hashTypedData>[0])).toBe("0xea39bcbff311817e02366c927b41493b78e44e1861d5b423ec7e071d511787b3");
  return {
    version: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    intentHash: "a".repeat(64),
    owner: { subject: "trade-user", address: SMART, chainId: 8453, accountProvider: "cdp-embedded" },
    signer: { smartAccount: SMART, signerAddress: SIGNER, ownerIndex: 0, deployed: true },
    request: { assetId: "cbbtc", side: "buy", amountBaseUnits: "1000000", slippageBps: 100 },
    quoteId: "quote-1",
    quoteBlockNumber: "100",
    balanceBlockNumber: "100",
    sellToken: TOKEN,
    spendAmount: "1000000",
    permitHash: PERMIT_HASH,
    permit: {
      domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
      types: {
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      primaryType: "PermitTransferFrom",
      message: {
        permitted: { token: TOKEN, amount: "1000000" },
        spender: TARGET,
        nonce: "7",
        deadline: "1788841200",
      },
    },
    signingTypedData,
    permitDeadline: "1788841200",
    createdAt: NOW,
    expiresAt: "2026-09-08T04:03:00.000Z",
    swapCallIndex: 1,
    draft: {
      kind: "swap",
      title: "Buy cbBTC",
      calls: [
        { to: TOKEN, data: "0x095ea7b3", value: "0", approval: { assetId: "usdc", spender: PERMIT2_ADDRESS } },
        { to: TARGET, data: "0x1234", value: "0" },
      ],
      amounts: [
        { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" },
        { assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: "99000", direction: "receive", estimated: true },
      ],
      warnings: ["exact review"],
      expiresAt: "2026-09-08T04:03:00.000Z",
      quoteId: "quote-1",
    },
    reservedActionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    reservedActionCreatedAt: NOW,
  };
}

function httpRequest() {
  return new Request("https://home.test/api/trades/id/finalize", {
    method: "POST",
    headers: { authorization: "Bearer aaa.bbb.ccc" },
  });
}

describe("Permit2 trade finalization", () => {
  test("recovers the server-bound EOA, appends one wrapper, and retries the same final action", async () => {
    const store = new MemoryTradeIntentStore();
    await store.issue(intent());
    const actions = new Map<string, PreparedMoneyAction>();
    let issueCalls = 0;
    const dependencies = {
      readBalance: async () => ({ address: SMART, token: TOKEN, balance: BigInt(2_000_000), blockNumber: BigInt(101) }),
      readPermit2State: async () => ({ blockNumber: BigInt(101), used: false }),
      resolveSigner: async () => ({ smartAccount: SMART, signerAddress: SIGNER, ownerIndex: 0 as const, deployed: true }),
      verifySmartAccountSignature: async () => true,
      intentStore: store,
      issueAction: async (_session: VerifiedAccountSession, draft: TradeIntent["draft"], options: { actionId: string; createdAt: string }) => {
        issueCalls += 1;
        const existing = actions.get(options.actionId);
        if (existing) return existing;
        const action: PreparedMoneyAction = {
          ...draft,
          id: options.actionId,
          reviewHash: "b".repeat(64),
          owner: { subject: "trade-user", address: SMART, chainId: 8453, accountProvider: "cdp-embedded" },
          createdAt: options.createdAt,
        };
        actions.set(action.id, action);
        return action;
      },
      now: () => new Date("2026-09-08T04:00:05.000Z"),
    };
    const input = {
      httpRequest: httpRequest(), session,
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      intentHash: "a".repeat(64), signature: SIGNATURE,
    };
    const first = await finalizeTradeAction(dependencies, input);
    const second = await finalizeTradeAction(dependencies, input);
    expect(first.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(second.id).toBe(first.id);
    expect(first.calls[1].data.startsWith("0x1234")).toBe(true);
    expect(first.calls[1].data.length).toBe(2 + 2 * 258);
    expect(issueCalls).toBe(2);
    const stored = await store.get(first.owner, input.intentId);
    expect(stored?.finalActionId).toBe(first.id);
    expect(stored?.signatureDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects a signer mismatch and a nonce that becomes used", async () => {
    for (const variant of ["signer", "nonce"] as const) {
      const store = new MemoryTradeIntentStore();
      await store.issue(intent());
      await expect(finalizeTradeAction({
        readBalance: async () => ({ address: SMART, token: TOKEN, balance: BigInt(2_000_000), blockNumber: BigInt(101) }),
        readPermit2State: async () => ({ blockNumber: BigInt(101), used: variant === "nonce" }),
        resolveSigner: async () => ({
          smartAccount: SMART,
          signerAddress: variant === "signer" ? TOKEN : SIGNER,
          ownerIndex: 0 as const,
          deployed: true,
        }),
        verifySmartAccountSignature: async () => true,
        intentStore: store,
        issueAction: async () => { throw new Error("must not issue"); },
        now: () => new Date("2026-09-08T04:00:05.000Z"),
      }, {
        httpRequest: httpRequest(), session,
        intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        intentHash: "a".repeat(64), signature: SIGNATURE,
      })).rejects.toMatchObject({ reason: variant === "signer" ? "signer-unsupported" : "permit-used" });
    }
  });

  test("appends a Base Account ERC-1271 signature without wrapping an EOA", async () => {
    const store = new MemoryTradeIntentStore();
    const stored: TradeIntent = {
      ...intent(),
      owner: { subject: "trade-user", address: SMART, chainId: 8453, accountProvider: "base-account" },
    };
    await store.issue(stored);
    const walletSignature = `0x${"ab".repeat(80)}` as const;
    let verifiedWrapper: string | undefined;
    const action = await finalizeTradeAction({
      readBalance: async () => ({ address: SMART, token: TOKEN, balance: BigInt(2_000_000), blockNumber: BigInt(101) }),
      readPermit2State: async () => ({ blockNumber: BigInt(101), used: false }),
      resolveSigner: async () => stored.signer,
      verifySmartAccountSignature: async ({ wrapper }) => {
        verifiedWrapper = wrapper;
        return true;
      },
      intentStore: store,
      issueAction: async (_session, draft, options) => ({
        ...draft,
        id: options.actionId,
        reviewHash: "b".repeat(64),
        owner: stored.owner,
        createdAt: options.createdAt,
      }),
      now: () => new Date("2026-09-08T04:00:05.000Z"),
    }, {
      httpRequest: httpRequest(),
      session: { ...session, accountProvider: "base-account" },
      intentId: stored.id,
      intentHash: stored.intentHash,
      signature: walletSignature,
    });
    expect(verifiedWrapper).toBe(walletSignature);
    expect(action.calls[1].data.endsWith(walletSignature.slice(2))).toBe(true);
    expect(action.owner.accountProvider).toBe("base-account");
  });

  test("preclaim validation rechecks quote age without requoting", async () => {
    const store = new MemoryTradeIntentStore();
    const stored = intent();
    await store.issue(stored);
    await store.bindFinalAction({
      owner: stored.owner, id: stored.id, intentHash: stored.intentHash,
      finalActionId: stored.reservedActionId, signatureDigest: "c".repeat(64),
    });
    const validate = createTradePreclaimValidator({
      intentStore: store,
      resolveSigner: async () => stored.signer,
      readBalance: async () => ({ address: SMART, token: TOKEN, balance: BigInt(2_000_000), blockNumber: BigInt(251) }),
      readPermit2State: async () => ({ blockNumber: BigInt(251), used: false }),
    });
    await expect(validate({
      request: httpRequest(), owner: stored.owner,
      action: { ...stored.draft, id: stored.reservedActionId, reviewHash: "d".repeat(64), owner: stored.owner, createdAt: NOW },
      now: "2026-09-08T04:00:05.000Z",
    })).rejects.toMatchObject({ reason: "stale-quote" });
  });
});
