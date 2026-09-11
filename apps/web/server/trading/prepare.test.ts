import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC } from "@/shared/trading/assets";
import { MemoryTradeIntentStore } from "./intent-store";
import { hashTypedData } from "viem";
import { PERMIT2_ADDRESS } from "./permit2";
import {
  prepareTradeAction,
  TradePreparationError,
  type TradePreparationFailure,
} from "./prepare";
import type {
  Permit2TypedData,
  TradeBalanceSnapshot,
  TradeQuote,
  TradeQuoteRequest,
} from "@/shared/trading/server-types";

const SMART = "0x1111111111111111111111111111111111111111" as const;
const SIGNER = "0x2222222222222222222222222222222222222222" as const;
const TARGET = "0x3333333333333333333333333333333333333333" as const;
const ROUTER_SPENDER = "0x4444444444444444444444444444444444444444" as const;
const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as const;
const USDC = BASE_USDC.contractAddress.toLowerCase() as `0x${string}`;
const NOW = new Date("2026-09-08T04:00:00.000Z");
const DEADLINE = String(Math.floor(NOW.getTime() / 1000) + 1200);

const session: VerifiedAccountSession = {
  user: { subject: "trade-user" },
  smartAccount: { address: SMART, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function permit(overrides: Partial<Permit2TypedData["message"]> = {}): Permit2TypedData {
  return {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
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
      permitted: { token: USDC, amount: "1000000" },
      spender: ROUTER_SPENDER,
      nonce: "7",
      deadline: DEADLINE,
      ...overrides,
    },
  };
}

function quote(permitData = permit(), overrides: Partial<Extract<TradeQuote, { liquidityAvailable: true }>> = {}) {
  return {
    liquidityAvailable: true,
    network: "base",
    fromToken: USDC,
    toToken: CBBTC,
    fromAmount: BigInt(1_000_000),
    toAmount: BigInt(100_000),
    minToAmount: BigInt(99_000),
    blockNumber: BigInt(100),
    fees: {},
    issues: {
      simulationIncomplete: false,
      allowance: { currentAllowance: BigInt(0), spender: PERMIT2_ADDRESS },
    },
    transaction: { to: TARGET, data: "0x1234", value: BigInt(0), gas: BigInt(100_000), gasPrice: BigInt(1) },
    permit2: { hash: hashTypedData(permitData as unknown as Parameters<typeof hashTypedData>[0]), eip712: permitData },
    ...overrides,
  } satisfies Extract<TradeQuote, { liquidityAvailable: true }>;
}

function balance(token: string, amount = BigInt(10_000_000), block = BigInt(101)): TradeBalanceSnapshot {
  return { address: SMART, token: token.toLowerCase() as `0x${string}`, balance: amount, blockNumber: block };
}

function request() {
  return new Request("https://home.test/api/trades", {
    method: "POST",
    headers: { authorization: "Bearer aaa.bbb.ccc", "content-type": "application/json" },
    body: "{}",
  });
}

function dependencies(tradeQuote: TradeQuote, store = new MemoryTradeIntentStore()) {
  const quoteRequests: TradeQuoteRequest[] = [];
  return {
    quoteRequests,
    store,
    value: {
      quoteClient: { async createSwapQuote(value: TradeQuoteRequest) { quoteRequests.push(value); return tradeQuote; } },
      readBalance: async (_address: `0x${string}`, token: `0x${string}`) => balance(token),
      readPermit2State: async () => ({ blockNumber: BigInt(101), used: false }),
      resolveSigner: async () => ({ smartAccount: SMART, signerAddress: SIGNER, ownerIndex: 0 as const, deployed: true }),
      intentStore: store,
      now: () => NOW,
    },
  };
}

describe("Permit2 trade intent preparation", () => {
  test("binds the verified smart-account taker and EOA signer while approving canonical Permit2", async () => {
    const fixture = dependencies(quote());
    const review = await prepareTradeAction(fixture.value, {
      httpRequest: request(), session,
      request: { assetId: "cbbtc", side: "buy", amountBaseUnits: "1000000", slippageBps: 100 },
    });
    expect(fixture.quoteRequests[0]).toMatchObject({ taker: SMART, signerAddress: SIGNER });
    expect(review.status).toBe("signature-required");
    expect(review.signerAddress).toBe(SIGNER);
    expect(review.permit.primaryType).toBe("PermitTransferFrom");
    expect(review.permit.message.spender).toBe(ROUTER_SPENDER);
    expect(review.receive.minimumAmountBaseUnits).toBe("99000");
    expect(review.expiresAt).toBe("2026-09-08T04:03:00.000Z");
    const stored = await fixture.store.get({
      subject: "trade-user", address: SMART, chainId: 8453, accountProvider: "cdp-embedded",
    }, review.id);
    expect(stored?.draft.calls[0].approval).toEqual({ assetId: "usdc", spender: PERMIT2_ADDRESS });
    expect(stored?.draft.calls[0].data).toContain(PERMIT2_ADDRESS.slice(2));
    expect(stored?.permit.message.spender).toBe(ROUTER_SPENDER);
    expect(stored?.intentHash).toBe(review.intentHash);
    expect(stored?.finalActionId).toBeUndefined();
  });

  test("rejects provider hash, token/amount, and nonce tampering before storing an intent", async () => {
    const cases: Array<{ quote: TradeQuote; reason: TradePreparationFailure; used?: boolean }> = [
      { quote: quote(permit(), { permit2: { hash: `0x${"00".repeat(32)}`, eip712: permit() } }), reason: "quote-rejected" },
      { quote: quote(permit({ permitted: { token: CBBTC, amount: "1000000" } })), reason: "quote-rejected" },
      { quote: quote(permit(), { minToAmount: BigInt(98_999) }), reason: "quote-rejected" },
      { quote: quote(), reason: "permit-used", used: true },
    ];
    for (const item of cases) {
      const store = new MemoryTradeIntentStore();
      const fixture = dependencies(item.quote, store);
      fixture.value.readPermit2State = async () => ({ blockNumber: BigInt(101), used: Boolean(item.used) });
      await expect(prepareTradeAction(fixture.value, {
        httpRequest: request(), session,
        request: { assetId: "cbbtc", side: "buy", amountBaseUnits: "1000000", slippageBps: 100 },
      })).rejects.toMatchObject({ reason: item.reason });
    }
  });

  test("keeps stocks eligibility-locked before signer or quote resolution", async () => {
    let signerCalls = 0;
    const fixture = dependencies({ liquidityAvailable: false });
    fixture.value.resolveSigner = async () => {
      signerCalls += 1;
      throw new TradePreparationError("signer-unsupported");
    };
    await expect(prepareTradeAction(fixture.value, {
      httpRequest: request(), session,
      request: { assetId: "nvdac", side: "buy", amountBaseUnits: "1000000", slippageBps: 100 },
    })).rejects.toMatchObject({ reason: "stock-eligibility" });
    expect(signerCalls).toBe(0);
  });

  test("prepares a Base Account session the same way as an email CDP session", async () => {
    const fixture = dependencies(quote());
    const review = await prepareTradeAction(fixture.value, {
      httpRequest: request(),
      session: { ...session, accountProvider: "base-account" },
      request: { assetId: "cbbtc", side: "buy", amountBaseUnits: "1000000", slippageBps: 100 },
    });
    expect(review.status).toBe("signature-required");
    expect(review.permit.primaryType).toBe("PermitTransferFrom");
    const stored = await fixture.store.get({
      subject: "trade-user", address: SMART, chainId: 8453, accountProvider: "base-account",
    }, review.id);
    expect(stored?.owner.accountProvider).toBe("base-account");
    expect(stored?.intentHash).toBe(review.intentHash);
  });
});
