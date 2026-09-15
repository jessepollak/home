import "server-only";

import { afterEach, describe, expect, test } from "bun:test";
import { encodeFunctionData, type Hex } from "viem";
import { BASE_BUILDER_CODE, currencyInfo, getPaymentMethodsCatalog, getSpreadOracleConfig, resolvePaymentMethodHashFromCatalog } from "@zkp2p/sdk";
import { BASE_USDC_ADDRESS, CASH_ATTRIBUTION_CODE, buildIntentAmountRange } from "@zkp2p/cash";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { setActionsStoreForTests, type ActionRow, type ActionsStore } from "@/server/actions/store";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { peerProvider } from "@/server/funding/providers/peer/adapter";
import { PEER_CREATE_DEPOSIT_ABI, PEER_WITHDRAW_ABI } from "@/server/funding/providers/peer/abi";
import { setPeerClientFactoryForTests } from "@/server/funding/providers/peer/offramp";
import { PEER_PRODUCTION_CONTRACTS } from "@/server/funding/providers/peer/manifest";
import { CashoutPreparationError, hasRecentHashlessCashout, listCashoutOrders, prepareCashoutAction, prepareCashoutWithdrawAction } from "./cash-out";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PAYEE_HASH = `0x${"ab".repeat(32)}` as Hex;
const session: VerifiedAccountSession = { user: { subject: "subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" };

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
function installClients(withOrder = false) {
  const amount = BigInt(2_000_000);
  const depositId = `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`;
  const order = {
    depositId, state: "awaiting-buyer", fills: [], totalAmount: amount, filledAmount: BigInt(0), pendingAmount: BigInt(0), returnedAmount: BigInt(0),
    nextActions: ["withdraw"], updatedAt: Math.floor(Date.now() / 1000), isInFlight: true,
    payouts: [{ platform: "cashapp", platformHash: "0x", currency: "USD", currencyHash: "0x", payeeHash: PAYEE_HASH, active: true, pricing: { marketRate: true } }],
  };
  const withdrawData = encodeFunctionData({ abi: PEER_WITHDRAW_ABI, functionName: "withdrawDeposit", args: [BigInt(7)] });
  const cash = {
    capabilities: () => ({ environment: "production", chainId: 8453, token: { address: BASE_USDC_ADDRESS }, amount: { min: BigInt(10_000), max: null }, platforms: [{ platform: "cashapp", currencies: ["USD"], payeeHint: "Cashtag", requiresIdentityAttestation: false }] }),
    orders: async () => withOrder ? [order] : [],
    order: async () => order,
    prepareWithdraw: async () => ({ txs: [{ to: PEER_PRODUCTION_CONTRACTS.escrow, data: `${withdrawData}${suffix().slice(2)}`, value: BigInt(0) }], steps: [] }),
    estimate: async () => ({ amount, currency: "USD", receiveAmount: 2, asOf: Math.floor(Date.now() / 1000) }),
  };
  const sdk = {
    chainId: 8453, runtimeEnv: "production", escrowV2Address: PEER_PRODUCTION_CONTRACTS.escrow, intentGuardianAddress: PEER_PRODUCTION_CONTRACTS.intentGuardian,
    registerPayeeDetails: async () => ({ hashedOnchainIds: [PAYEE_HASH] }),
    prepareCreateDeposit: async () => ({ prepared: { ...validCall(), value: BigInt(0), chainId: 8453 } }),
  };
  setPeerClientFactoryForTests(() => ({ environment: "production", cash: cash as never, sdk: sdk as never }));
}
function input() {
  return { providerId: "peer", region: "US", assetId: "base:usdc", amountBaseUnits: "2000000", platform: "cashapp", currency: "USD", payoutHandle: "$Alice", canonicalHandleConfirmation: "Alice" };
}
function row(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111", owner_key: "owner", provider: "cdp-embedded", kind: "cash-out",
    summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: new Date(Date.now() + 60_000).toISOString() }, pending: null,
    created_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), provider_handle: null, transaction_hash: null, handle_recorded_at: null,
    ...overrides,
  };
}
afterEach(() => {
  setPeerClientFactoryForTests(null);
  setActionsStoreForTests(null);
});

describe("Peer cash-out action preparation", () => {
  test("authors an exact approval and preserves reviewed identity/estimate metadata", async () => {
    installClients();
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { list: async () => [] }, readAllowance: async () => BigInt(0),
    });
    expect(draft.kind).toBe("cash-out");
    expect(draft.calls).toHaveLength(2);
    expect(draft.calls[0]?.approval).toEqual({ assetId: "usdc", spender: PEER_PRODUCTION_CONTRACTS.escrow });
    expect(draft.amounts[0]?.assetId).toBe("usdc");
    expect(draft.calls[0]?.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(BigInt(`0x${draft.calls[0]!.data.slice(74)}`)).toBe(BigInt(2_000_000));
    expect(draft.metadata).toMatchObject({ product: "cashout", canonicalHandle: "Alice", approximateFiatAmount: "2", minConversionRate: "1" });
    expect(Date.parse(draft.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  test("successfully issues a first-allowance action through canonical approval validation", async () => {
    installClients();
    const inserts: unknown[] = [];
    setActionsStoreForTests({ insert: async (value: unknown) => { inserts.push(value); } } as ActionsStore);
    const draft = await prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { list: async () => [] }, readAllowance: async () => BigInt(0),
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
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { list: async () => [] }, readAllowance: async () => BigInt(2_000_000),
    });
    expect(draft.calls).toHaveLength(1);
    expect(draft.calls[0]?.to).toBe(PEER_PRODUCTION_CONTRACTS.escrow);
  });

  test("rejects non-verbatim canonical confirmation before curator registration", async () => {
    installClients();
    await expect(prepareCashoutAction(session, { ...input(), canonicalHandleConfirmation: "$Alice" }, undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { list: async () => [] }, readAllowance: async () => BigInt(0),
    })).rejects.toMatchObject({ code: "identity-mismatch" });
  });

  test("requires the exact enablement value for direct preparation", async () => {
    for (const disabled of [undefined, "0", "false"]) {
      await expect(prepareCashoutAction(session, input(), undefined, { env: { PEER_OFFRAMP_ENABLED: disabled } })).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  test("lists owner recovery orders with provider labels while discovery is disabled", async () => {
    installClients(true);
    for (const disabled of [undefined, "0", "false"]) {
      const result = await listCashoutOrders(
        session,
        { region: "US", inFlight: true },
        { PEER_OFFRAMP_ENABLED: disabled },
        { store: { hasCashoutHistory: async () => true, cashoutRecoveryModes: async () => ["production"] } },
      );
      expect(result.recoveryEligible).toBe(true);
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0]).toMatchObject({
        providerId: "peer", providerName: "Peer", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6,
        platform: "cashapp", platformLabel: "Cash App",
      });
      expect(result.orders[0]).not.toHaveProperty("owner");
      expect(result.orders[0]).not.toHaveProperty("payeeHash");
    }
  });

  test("does not query disabled Peer recovery without owner history or an explicit request", async () => {
    installClients(true);
    const store = { hasCashoutHistory: async () => false, cashoutRecoveryModes: async () => [] };
    expect(await listCashoutOrders(session, { region: "US" }, { PEER_OFFRAMP_ENABLED: "0" }, { store }))
      .toEqual({ recoveryEligible: false, orders: [] });
    expect((await listCashoutOrders(session, { region: "US", recover: true }, { PEER_OFFRAMP_ENABLED: "0" }, { store })).orders).toHaveLength(1);
  });

  test("fails closed on the legacy global sandbox setting before provider reads", async () => {
    let historyReads = 0;
    await expect(listCashoutOrders(
      session,
      { region: "US" },
      { FUNDING_SANDBOX: "", PEER_OFFRAMP_ENABLED: "1" },
      { store: {
        hasCashoutHistory: async () => { historyReads += 1; return false; },
        cashoutRecoveryModes: async () => [],
      } },
    )).rejects.toMatchObject({ code: "FUNDING_SANDBOX_MIGRATION_REQUIRED" });
    expect(historyReads).toBe(1);
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
  });

  test("enforces the 15-minute confirmed hashless ambiguity window", async () => {
    const now = new Date();
    expect(hasRecentHashlessCashout([row({ confirmed_at: new Date(now.getTime() - 14 * 60_000).toISOString() })], now)).toBe(true);
    expect(hasRecentHashlessCashout([row({ confirmed_at: new Date(now.getTime() - 15 * 60_000).toISOString() })], now)).toBe(false);
    installClients();
    await expect(prepareCashoutAction(session, input(), undefined, {
      env: { PEER_OFFRAMP_ENABLED: "1" }, store: { list: async () => [row()] }, readAllowance: async () => BigInt(0),
    })).rejects.toBeInstanceOf(CashoutPreparationError);
  });
});
