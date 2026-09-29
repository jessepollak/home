import "server-only";

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { encodeFunctionData, type Hex } from "viem";
import { BASE_BUILDER_CODE, currencyInfo, getPaymentMethodsCatalog, getSpreadOracleConfig, resolvePaymentMethodHashFromCatalog } from "@zkp2p/sdk";
import { BASE_USDC_ADDRESS, CASH_ATTRIBUTION_CODE, buildIntentAmountRange } from "@zkp2p/cash";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { CashoutQuote } from "@/shared/funding/cash-out-quote";
import { setActionsStoreForTests, type ActionRow, type ActionsStore, type CashoutOrderRow } from "@/server/actions/store";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { peerProvider } from "@/server/funding/providers/peer/adapter";
import { PEER_CREATE_DEPOSIT_ABI, PEER_WITHDRAW_ABI } from "@/server/funding/providers/peer/abi";
import { setPeerClientFactoryForTests } from "@/server/funding/providers/peer/offramp";
import { PEER_PRODUCTION_CONTRACTS } from "@/server/funding/providers/peer/manifest";
import { prepareCashoutAction, prepareCashoutWithdrawAction, recentHashlessCashouts } from "./cash-out";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PAYEE_HASH = `0x${"ab".repeat(32)}` as Hex;
const NOW = new Date("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(NOW));
const session: VerifiedAccountSession = { user: { subject: "subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" };
const originalEstimate = peerProvider.offramp!.estimate;
const validQuote: CashoutQuote = {
  fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null },
  rate: null, receive: { amount: "2", currency: "USD", approximate: true }, arrival: { source: "unknown" },
};

function suffix(): Hex {
  const bytes = new TextEncoder().encode(`${CASH_ATTRIBUTION_CODE},${BASE_BUILDER_CODE}`);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}${bytes.length.toString(16).padStart(2, "0")}00${"8021".repeat(8)}`;
}
function validCall(amount = BigInt(2_000_000)) {
  const ctx = createProviderContext({ manifest: peerProvider.manifest, region: "US", direction: "offramp", paymentMethodId: "cashapp", env: { PEER_OFFRAMP_ENABLED: "1" } });
  const oracle = getSpreadOracleConfig("USD")!;
  const params = {
    token: BASE_USDC_ADDRESS, amount, intentAmountRange: buildIntentAmountRange(amount),
    paymentMethods: [resolvePaymentMethodHashFromCatalog("cashapp", getPaymentMethodsCatalog(8453, "production"))],
    paymentMethodData: [{ intentGatingService: ctx.deployment.contracts.intentGatingService, payeeDetails: PAYEE_HASH, data: "0x" }],
    currencies: [[{ code: currencyInfo.USD.currencyCodeHash, minConversionRate: BigInt(1), oracleRateConfig: { adapter: oracle.adapter, adapterConfig: oracle.adapterConfig, spreadBps: 0, maxStaleness: oracle.maxStaleness } }]],
    delegate: "0x0000000000000000000000000000000000000000", intentGuardian: ctx.deployment.contracts.intentGuardian, retainOnEmpty: false,
  };
  const canonical = encodeFunctionData({ abi: PEER_CREATE_DEPOSIT_ABI, functionName: "createDeposit", args: [params] });
  return { to: ctx.deployment.contracts.escrow, data: `${canonical}${suffix().slice(2)}` as Hex, value: "0" };
}
function installClients(withOrder = false, payeeHashes: readonly string[] = [PAYEE_HASH], preparedAmount = BigInt(2_000_000), registeredPayees?: string[]) {
  const amount = BigInt(2_000_000);
  const orders = payeeHashes.map((payeeHash, index) => ({
    depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_${7 + index}`,
    state: "awaiting-buyer", fills: [], totalAmount: amount, filledAmount: BigInt(0), pendingAmount: BigInt(0), returnedAmount: BigInt(0),
    nextActions: ["withdraw"], updatedAt: NOW.getTime() / 1000, isInFlight: true,
    payouts: [{ platform: "cashapp", platformHash: "0x", currency: "USD", currencyHash: "0x", payeeHash, active: true, pricing: { marketRate: true } }],
  }));
  const order = orders[0]!;
  const withdrawData = encodeFunctionData({ abi: PEER_WITHDRAW_ABI, functionName: "withdrawDeposit", args: [BigInt(7)] });
  const cash = {
    capabilities: () => ({ environment: "production", chainId: 8453, token: { address: BASE_USDC_ADDRESS }, amount: { min: BigInt(10_000), max: null }, platforms: [{ platform: "cashapp", currencies: ["USD"], payeeHint: "Cashtag", requiresIdentityAttestation: false }] }),
    orders: async () => withOrder ? orders : [],
    order: async () => order,
    prepareWithdraw: async () => ({ txs: [{ to: PEER_PRODUCTION_CONTRACTS.escrow, data: `${withdrawData}${suffix().slice(2)}`, value: BigInt(0) }], steps: [] }),
    estimate: async () => ({ amount: preparedAmount, currency: "USD", receiveAmount: 2, asOf: NOW.getTime() / 1000 }),
  };
  const sdk = {
    chainId: 8453, runtimeEnv: "production", escrowV2Address: PEER_PRODUCTION_CONTRACTS.escrow, intentGuardianAddress: PEER_PRODUCTION_CONTRACTS.intentGuardian,
    registerPayeeDetails: async (value: { payeeData: { offchainId: string }[] }) => { registeredPayees?.push(value.payeeData[0]!.offchainId); return { hashedOnchainIds: [PAYEE_HASH] }; },
    prepareCreateDeposit: async () => ({ prepared: { ...validCall(preparedAmount), value: BigInt(0), chainId: 8453 } }),
  };
  setPeerClientFactoryForTests(() => ({ environment: "production", cash: cash as never, sdk: sdk as never }));
}
function input() {
  return { providerId: "peer", region: "US", assetId: "base:usdc", amountBaseUnits: "2000000", platform: "cashapp", currency: "USD", payoutHandle: "$Alice" };
}
function row(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111", owner_key: "owner", provider: "cdp-embedded", kind: "cash-out",
    summary: { title: "Cash out", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "2000000", direction: "spend" }], warnings: [],
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), metadata: {
        product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production", region: "US",
        platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "Alice", payeeHash: PAYEE_HASH,
        approximateFiatAmount: "2", minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
        estimateAsOf: NOW.toISOString(), escrow: PEER_PRODUCTION_CONTRACTS.escrow,
      } }, pending: null,
    created_at: NOW.toISOString(), confirmed_at: NOW.toISOString(), provider_handle: null, transaction_hash: null, handle_recorded_at: null,
    account_address: "0x1111111111111111111111111111111111111111", declined_reported_at: null, dispatch_attempt: 0, outcome: null,
    outcome_source: null, settled_at: null, outcome_recorded_at: null,
    ...overrides,
  };
}
const clearStore = { list: async () => [], hasUnsettledCashout: async () => false, cashoutOrders: async () => [] };
function order(overrides: Partial<CashoutOrderRow> = {}): CashoutOrderRow {
  return {
    action_id: row().id, owner_key: "owner", provider_id: "peer", environment: "production", region: "US", deposit_id: null, deposit_proven: false,
    state: "awaiting-buyer", platform: "cashapp", platform_label: "Cash App", amount_atomic: "2000000", filled_atomic: "0",
    returned_atomic: "0", remaining_atomic: "2000000", withdrawable: true, eta_seconds: null,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(), refreshed_at: null, settled_at: null,
    ...overrides,
  };
}
afterEach(() => {
  setPeerClientFactoryForTests(null);
  setActionsStoreForTests(null);
  peerProvider.offramp!.estimate = originalEstimate;
  setSystemTime();
});

describe("Peer cash-out action preparation", () => {
  test("authors an exact approval and preserves reviewed identity/estimate metadata", async () => {
    installClients();
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    });
    expect(draft.kind).toBe("cash-out");
    expect(draft.calls).toHaveLength(2);
    expect(draft.calls[0]?.approval).toEqual({ assetId: "usdc", spender: PEER_PRODUCTION_CONTRACTS.escrow });
    expect(draft.amounts[0]?.assetId).toBe("usdc");
    expect(draft.calls[0]?.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(BigInt(`0x${draft.calls[0]!.data.slice(74)}`)).toBe(BigInt(2_000_000));
    expect(draft.metadata).toMatchObject({ product: "cashout", region: "US", canonicalHandle: "Alice", payeeHash: PAYEE_HASH.toLowerCase(), approximateFiatAmount: "2", minConversionRate: "1" });
    expect(draft.metadata).toMatchObject({
      etaSeconds: null,
      quote: {
        fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null },
        rate: null,
        receive: { amount: "2", currency: "USD", approximate: true },
        arrival: { source: "unknown" },
      },
    });
    expect(Date.parse(draft.expiresAt) - NOW.getTime()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  test.each([
    { name: "malformed quote", quote: { ...validQuote, receive: { amount: "not-an-amount", currency: "USD", approximate: true } } },
    { name: "wrong receive currency", quote: { ...validQuote, receive: { amount: "2", currency: "EUR", approximate: true } } },
    { name: "operator fee", quote: { ...validQuote, fees: { ...validQuote.fees, operator: { amount: "0.01", currency: "USD" } } } },
    { name: "wrong rate source", quote: { ...validQuote, rate: { from: "ETH", to: "USD", value: "1" } } },
    { name: "wrong rate destination", quote: { ...validQuote, rate: { from: "USDC", to: "EUR", value: "1" } } },
    { name: "rate without a conversion", quote: { ...validQuote, rate: { from: "USDC", to: "USD", value: "1" } } },
  ])("fails closed with CASHOUT_UNAVAILABLE for a $name", async ({ quote }) => {
    installClients();
    peerProvider.offramp!.estimate = async (estimateInput, ctx) => ({
      ...(await originalEstimate(estimateInput, ctx)), quote: quote as CashoutQuote,
    });
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "unavailable", message: "Peer cash-out is unavailable for this selection." });
  });

  test("successfully issues a first-allowance action through canonical approval validation", async () => {
    installClients();
    const inserts: unknown[] = [];
    setActionsStoreForTests({ insert: async (value: unknown) => { inserts.push(value); } } as ActionsStore);
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    });

    const issued = await issueMoneyAction(session, draft);

    expect(issued.kind).toBe("cash-out");
    expect(issued.calls[0]?.approval?.assetId).toBe("usdc");
    expect(issued.amounts[0]?.assetId).toBe("usdc");
    expect(inserts).toHaveLength(1);
  });

  test("omits approval only when allowance already covers the exact reviewed amount", async () => {
    installClients();
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(2_000_000),
    });
    expect(draft.calls).toHaveLength(1);
    expect(draft.calls[0]?.to).toBe(PEER_PRODUCTION_CONTRACTS.escrow);
  });

  test.each(["   ", "$"])("rejects an empty canonical cash app destination", async (payoutHandle) => {
    installClients();
    await expect(prepareCashoutAction(session, { ...input(), payoutHandle }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "invalid-input", message: "Enter a valid payout destination." });
  });

  test("rejects the legacy confirmation key", async () => {
    await expect(prepareCashoutAction(session, { ...input(), canonicalHandleConfirmation: "Alice" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" },
    })).rejects.toMatchObject({ code: "invalid-input" });
  });

  test("passes a canonical Cash App payee to Peer and metadata", async () => {
    const registeredPayees: string[] = [];
    installClients(false, [PAYEE_HASH], BigInt(2_000_000), registeredPayees);
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    });
    expect(registeredPayees).toEqual(["Alice"]);
    expect(draft.metadata).toMatchObject({ canonicalHandle: "Alice" });
  });

  test("rejects a euro-area cash-out aimed at another market's platform or currency", async () => {
    for (const overrides of [
      { region: "DE", platform: "zelle", currency: "EUR" },
      { region: "DE", platform: "revolut", currency: "USD" },
    ]) {
      await expect(prepareCashoutAction(session, { ...input(), ...overrides }, undefined, {
        env: { PEER_OFFRAMP_ENABLED: "1" },
      })).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  test("requires the exact enablement value for direct preparation", async () => {
    for (const disabled of [undefined, "0", "false"]) {
      await expect(prepareCashoutAction(session, input(), undefined, { env: { PEER_OFFRAMP_ENABLED: disabled } })).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  test("keeps preparation fail-closed when an in-flight row has a malformed payee", async () => {
    installClients(true, ["invalid"]);
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0),
    })).rejects.toThrow("Peer order payee hash is invalid");
  });

  test("refuses an unsettled local cash-out before querying Peer", async () => {
    installClients(true, ["invalid"]);
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, hasUnsettledCashout: async () => true },
    })).rejects.toMatchObject({ code: "order-in-flight", message: "A cash-out for this amount to this payee is still in progress. Check Activity." });
  });

  test("keeps withdrawal recovery available while new Peer cash-outs are disabled", async () => {
    installClients(true);
    const draft = await prepareCashoutWithdrawAction(session, {
      providerId: "peer", region: "US", depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`,
    }, { env: { PEER_OFFRAMP_ENABLED: "0" } });
    expect(draft.kind).toBe("cash-out-withdraw");
    expect(draft.amounts[0]?.assetId).toBe("usdc");
    expect(draft.metadata).toMatchObject({ operation: "withdraw", providerName: "Peer", platformLabel: "Cash App" });
    expect(draft.metadata).not.toHaveProperty("canonicalHandle");
    expect(draft.metadata).not.toHaveProperty("payeeHash");
  });

  test("refuses new cash-outs for a removed region or unavailable region settings", async () => {
    installClients();
    for (const [regionOffered, code] of [[async () => false, "unavailable"], [async () => { throw new Error("settings unavailable"); }, "settings-unavailable"]] as const) {
      await expect(prepareCashoutAction(session, input(), undefined, {
        env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(0), regionOffered,
      })).rejects.toMatchObject({ code });
    }
  });

  test("enforces the 15-minute confirmed hashless ambiguity window", async () => {
    const now = new Date(NOW);
    expect(recentHashlessCashouts([row({ confirmed_at: new Date(now.getTime() - 14 * 60_000).toISOString() })], now)).toHaveLength(1);
    expect(recentHashlessCashouts([row({ confirmed_at: new Date(now.getTime() - 15 * 60_000).toISOString() })], now)).toHaveLength(0);
    expect(recentHashlessCashouts([row({ confirmed_at: new Date(now.getTime() - 14 * 60_000).toISOString(), outcome: "not_submitted", outcome_source: "wallet" })], now)).toHaveLength(0);
    installClients();
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()] }, readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "duplicate-unknown", message: "A cash-out for this amount to this payee may still be in progress. Check Activity." });
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()], cashoutOrders: async () => [order()] },
      readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "duplicate-unknown" });
  });

  test("refuses the same payee in different letter case while another cash-out is hashless", async () => {
    installClients();
    await expect(prepareCashoutAction(session, { ...input(), payoutHandle: "$alice" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()] }, readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "duplicate-unknown" });
  });

  test("prepares a different amount while another cash-out is hashless", async () => {
    installClients(false, [PAYEE_HASH], BigInt(3_000_000));
    const draft = await prepareCashoutAction(session, { ...input(), amountBaseUnits: "3000000" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()] }, readAllowance: async () => BigInt(3_000_000),
    });
    expect(draft.amounts[0]?.amountBaseUnits).toBe("3000000");
  });

  test("prepares for a different payee while another cash-out is hashless", async () => {
    installClients();
    const draft = await prepareCashoutAction(session, { ...input(), payoutHandle: "$Bob" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()] }, readAllowance: async () => BigInt(2_000_000),
    });
    expect(draft.metadata).toMatchObject({ canonicalHandle: "Bob" });
  });

  test("prepares for a different payee while another cash-out has an unsettled local order", async () => {
    installClients();
    const draft = await prepareCashoutAction(session, { ...input(), payoutHandle: "$Bob" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: {
        ...clearStore, hasUnsettledCashout: async (_owner, intent) => intent.canonicalHandle === "Alice",
      }, readAllowance: async () => BigInt(2_000_000),
    });
    expect(draft.metadata).toMatchObject({ canonicalHandle: "Bob" });
  });

  test("prepares a different amount despite an in-flight provider order, but refuses the identical intent", async () => {
    installClients(true, [PAYEE_HASH], BigInt(3_000_000));
    const dependencies = { env: { PEER_OFFRAMP_ENABLED: "1" }, store: clearStore, readAllowance: async () => BigInt(3_000_000) };
    const draft = await prepareCashoutAction(session, { ...input(), amountBaseUnits: "3000000" }, undefined, dependencies);
    expect(draft.amounts[0]?.amountBaseUnits).toBe("3000000");
    installClients(true);
    await expect(prepareCashoutAction(session, input(), undefined, dependencies)).rejects.toMatchObject({
      code: "order-in-flight", message: "A cash-out for this amount and payout app is still in progress. Check Activity.",
    });
  });

  test("lets a recovered hashless cash-out that already settled stop blocking the next one", async () => {
    installClients();
    const settled = order({ deposit_id: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`, state: "delivered", settled_at: NOW.toISOString() });
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { ...clearStore, list: async () => [row()], cashoutOrders: async () => [settled] },
      readAllowance: async () => BigInt(0),
    });
    expect(draft.kind).toBe("cash-out");
  });

  test("hands a recovered hashless cash-out that is still open to the in-progress guard", async () => {
    installClients();
    const linked = order({ deposit_id: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7` });
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" },
      store: { list: async () => [row()], cashoutOrders: async () => [linked], hasUnsettledCashout: async () => true },
      readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "order-in-flight" });
  });
});
