import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { encodeFunctionData, erc20Abi } from "viem";
import { parseHash32 } from "@/shared/chain/hex";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { PRODUCT_NOT_OFFERED_CODE, parsePrepareActionErrorResponse, parseProductNotOfferedPrepareErrorResponse } from "@/shared/actions/contracts/prepare";
import { SavingsActionError } from "@/server/savings/prepare";
import { VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { TRADE_ACTION_CONTRACT_VERSION } from "@/shared/trading/contract";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { makePaymasterApproval, NetworkFeeUnfundedError } from "@/server/paymaster/fee";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS, NETWORK_FEE_ETH_UNFUNDED_MESSAGE, NETWORK_FEE_UNFUNDED_MESSAGE } from "@/shared/money-actions/network-fee";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { setActionsStoreForTests } from "./store";
import { TestActionsStore } from "@/tests/helpers/store-doubles";
import { TradePreparationError } from "./kinds/trade/permit2";
import { createPrepareActionHandler } from "./prepare";
import { CardAllowancePreparationError } from "@/server/cards/allowance/prepare";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(NOW));
const VAULT = VERIFIED_SAVE_VAULTS[0].address;
const BLOCK_HASH = parseHash32(`0x${"ab".repeat(32)}`);
if (!BLOCK_HASH) throw new Error("Expected a 32-byte block hash fixture.");
const MARKET = BORROW_MARKETS.find((market) => market.availability === "enabled");
if (!MARKET) throw new Error("Expected an enabled borrow market fixture.");

function request(kind = "savings-deposit") {
  return new Request("https://home.test/api/actions/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
    },
    body: JSON.stringify({
      kind,
      params: {
        vaultAddress: VAULT,
        amountBaseUnits: "1000000",
      },
    }),
  });
}

function savingsDraft(operation: "deposit" | "withdraw"): MoneyActionDraft {
  const deposit = operation === "deposit";
  const vault = VAULT;
  return {
    kind: deposit ? "savings-deposit" : "savings-withdraw",
    title: deposit ? "Deposit USDC" : "Withdraw USDC",
    calls: [{ to: vault, data: "0x1234", value: "0" }],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: deposit ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "1000000000000000000", direction: deposit ? "receive" : "spend", estimated: true },
    ],
    warnings: ["The wallet shows the Base network fee."],
    expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    metadata: {
      product: "savings",
      operation,
      vaultAddress: vault,
      vaultName: "Configured USDC vault",
      network: { name: "Base", chainId: 8453 },
      feeWad: "0",
      limitBaseUnits: "500000000",
      previewSharesBaseUnits: "1000000000000000000",
      shareDecimals: 18,
      exchangeConstraint: deposit ? "deposit-minimum-shares-or-revert" : "withdraw-exact-assets-or-revert",
      ...(deposit ? { minimumSharesBaseUnits: "999000000000000000" } : {}),
      discoveryRate: { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789214400" },
    },
  };
}

function borrowSnapshot(debtAssetsRaw: string): BorrowMarketSnapshot {
  if (MARKET === undefined) throw new Error("Expected an enabled borrow market fixture.");
  if (BLOCK_HASH === null) throw new Error("Expected a 32-byte block hash fixture.");
  const collateral = (BigInt(10_000) * BigInt(10) ** BigInt(MARKET.collateralToken.decimals)).toString();
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: MARKET.marketId, morpho: MARKET.morpho, loanToken: MARKET.loanToken, collateralToken: MARKET.collateralToken, oracle: MARKET.oracle, irm: MARKET.irm, lltvWad: MARKET.lltvWad.toString(), rank: MARKET.rank },
    eligibility: { mode: MARKET.availability, newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "51714405", blockHash: BLOCK_HASH, blockTimestamp: "1790218157", fetchedAt: "2026-09-24T02:49:17.000Z" },
    state: { oraclePriceRaw: "843242900000000000000000000000000000000", borrowRatePerSecondWad: "0", borrowAprWad: "0", totalSupplyAssetsRaw: "10000000000", totalBorrowAssetsRaw: "1000000000", totalBorrowSharesRaw: "1000000000", liquidityAssetsRaw: "9000000000", lastUpdateTimestamp: "1790218150" },
    wallet: { collateralBalanceRaw: collateral, loanBalanceRaw: "10000000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: collateral, borrowSharesRaw: "1000000", debtAssetsRaw, rawBorrowCapacityAssetsRaw: "1", borrowCapacityAssetsRaw: "1", rawWithdrawableCollateralRaw: collateral, withdrawableCollateralRaw: collateral, healthFactorWad: "1500000000000000000", liquidationPriceRaw: "1" },
  };
}

function authorized() {
  return Response.json({
    user: { subject: "prepare-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

afterEach(() => { setActionsStoreForTests(null); setSystemTime(); });

describe("prepare action handler", () => {
  test.each([
    ["invalid", "CARD_ALLOWANCE_INVALID", 400],
    ["not-ready", "CARD_ALLOWANCE_NOT_READY", 409],
    ["unchanged", "CARD_ALLOWANCE_UNCHANGED", 409],
    ["unavailable", "CARD_ALLOWANCE_UNAVAILABLE", 503],
  ] as const)("maps card allowance %s to %s", async (reason, code, status) => {
    const handler = createPrepareActionHandler({ authorize: async () => authorized(),
      prepareCardAllowance: async () => { throw new CardAllowancePreparationError(reason); } });
    const response = await handler(request("card-allowance"));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code } });
    expect(parsePrepareActionErrorResponse(body)).toEqual(body);
  });
  test("maps a removed card spender at issue time to unavailable", async () => {
    const before = process.env.BRIDGE_ENABLED;
    process.env.BRIDGE_ENABLED = "0";
    try {
      const handler = createPrepareActionHandler({ authorize: async () => authorized(), applyFee: async (_session, draft) => draft,
        prepareCardAllowance: async () => ({ kind: "card-allowance", title: "Set card spending limit", amounts: [], warnings: ["Card program spender"],
          expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
          calls: [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x65bf8b55EEDef53C094E40003a03390De744DF33", BigInt(25_000_000)] }),
            value: "0", approval: { assetId: "usdc", spender: "0x65bf8b55eedef53c094e40003a03390de744df33" } }],
          metadata: { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
            token: BASE_USDC_ADDRESS.toLowerCase() as `0x${string}`, spender: "0x65bf8b55eedef53c094e40003a03390de744df33",
            allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "0", maximumBaseUnits: "100000000", source: { blockNumber: "100" } },
        }),
      });
      const response = await handler(request("card-allowance"));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "CARD_ALLOWANCE_UNAVAILABLE" } });
    } finally {
      if (before === undefined) delete process.env.BRIDGE_ENABLED;
      else process.env.BRIDGE_ENABLED = before;
    }
  });
  test.each(["savings-deposit", "trade", "send"] as const)("blocks paused %s before building a draft and allows entries when on", async (kind) => {
    const store = new TestActionsStore();
    setActionsStoreForTests(store);
    const { inserts } = store;
    let prepared = 0;
    const settings = resolveProductOffering({ kind: "deployment" });
    const handler = (paused: boolean) => createPrepareActionHandler({
      authorize: async () => authorized(),
      readOffering: async () => paused ? { ...settings, products: { ...settings.products, save: "exit-only", invest: "exit-only", send: "off" } } : settings,
      prepareSavings: async () => { prepared++; return savingsDraft("deposit"); },
      prepareTrade: async () => { prepared++; throw new TradePreparationError("no-liquidity"); },
      applyFee: async (_session, draft) => draft,
    });
    const input = () => kind === "trade" ? new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind, params: { version: TRADE_ACTION_CONTRACT_VERSION, assetId: "cbbtc", direction: "buy", amountBaseUnits: "1000000" } }),
    }) : kind === "send" ? new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind, params: { assetId: "usdc", recipient: OWNER, amountBaseUnits: "1000000" } }),
    }) : request(kind);
    const blocked = await handler(true)(input());
    expect(blocked.status).toBe(409);
    expect(parseProductNotOfferedPrepareErrorResponse(await blocked.json())?.error.code).toBe(PRODUCT_NOT_OFFERED_CODE);
    expect(prepared).toBe(0);
    const allowed = await handler(false)(input());
    expect(allowed.status).toBe(kind === "trade" ? 422 : 201);
    if (kind !== "trade") expect(inserts).toHaveLength(1);
  });
  test("blocks Save deposits when the verified vault is reducing-only, not just when Save is paused", async () => {
    const deployment = resolveProductOffering({ kind: "deployment" });
    const paused = resolveProductOffering({ kind: "saved", value: { products: deployment.products, vaults: { ...deployment.vaults, [VERIFIED_SAVE_VAULTS[0].id]: "reducing-only" }, markets: deployment.markets } });
    let prepared = 0;
    const handler = createPrepareActionHandler({ authorize: async () => authorized(), readOffering: async () => paused,
      prepareSavings: async () => { prepared++; return savingsDraft("deposit"); } });
    const result = await handler(request());
    expect(result.status).toBe(409);
    expect(parseProductNotOfferedPrepareErrorResponse(await result.json())?.error.code).toBe(PRODUCT_NOT_OFFERED_CODE);
    expect(prepared).toBe(0);
  });

  test.each(["savings-withdraw", "trade"] as const)("does not read settings for %s exits", async (kind) => {
    setActionsStoreForTests(new TestActionsStore());
    let reads = 0;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      readOffering: async () => { reads++; throw new Error("db outage"); },
      prepareSavings: async () => savingsDraft("withdraw"),
      prepareTrade: async () => { throw new TradePreparationError("no-liquidity"); },
      applyFee: async (_session, draft) => draft,
    });
    const input = kind === "trade" ? new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind, params: { version: TRADE_ACTION_CONTRACT_VERSION, assetId: "cbbtc", direction: "sell", amountBaseUnits: "all" } }),
    }) : request(kind);
    expect((await handler(input)).status).toBe(kind === "trade" ? 422 : 201);
    expect(reads).toBe(0);
  });
  test("borrow uses the offered market ceiling, rejects a paused market and prepares when enabled", async () => {
    const store = new TestActionsStore();
    setActionsStoreForTests(store);
    const { inserts } = store;
    const snapshot = borrowSnapshot("1000000");
    const deployment = resolveProductOffering({ kind: "deployment" });
    const marketPaused = resolveProductOffering({ kind: "saved", value: { products: deployment.products, vaults: deployment.vaults, markets: { ...deployment.markets, [MARKET.marketId]: "reducing-only" } } });
    const handler = (pause: boolean) => createPrepareActionHandler({ authorize: async () => authorized(),
      readOffering: async () => pause ? marketPaused : deployment,
      borrowRpc: { readSnapshots: async () => [], readSnapshot: async () => snapshot, simulateBatch: async () => {} },
      applyFee: async (_session, draft) => draft,
    });
    const input = () => new Request("https://home.test/api/actions/prepare", { method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind: "borrow", params: { marketId: MARKET.marketId, operation: "borrow", amountBaseUnits: "100" } }) });
    const blocked = await handler(true)(input());
    expect(blocked.status).toBe(409);
    expect(parseProductNotOfferedPrepareErrorResponse(await blocked.json())?.error.code).toBe(PRODUCT_NOT_OFFERED_CODE);
    const allowed = await handler(false)(input());
    expect(allowed.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.summary.metadata).toMatchObject({ product: "borrow", operation: "borrow", marketId: MARKET.marketId });
    let reads = 0;
    const exit = createPrepareActionHandler({ authorize: async () => authorized(),
      readOffering: async () => { reads++; throw new Error("db outage"); },
      borrowRpc: { readSnapshots: async () => [], readSnapshot: async () => snapshot, simulateBatch: async () => {} },
      applyFee: async (_session, draft) => draft,
    });
    for (const operation of ["repay", "repay-all", "close-position", "supply-collateral"] as const) {
      const kind = operation === "repay-all" || operation === "close-position" ? "repay" : operation;
      const response = await exit(new Request("https://home.test/api/actions/prepare", { method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
        body: JSON.stringify({ kind, params: { marketId: MARKET.marketId, operation, ...(operation === "repay-all" || operation === "close-position" ? { maximumRepayBaseUnits: "1250000" } : { amountBaseUnits: "100" }) } }) }));
      expect(response.status).toBe(201);
    }
    const withdraw = createPrepareActionHandler({ authorize: async () => authorized(), readOffering: async () => { reads++; throw new Error("db outage"); },
      borrowRpc: { readSnapshots: async () => [], readSnapshot: async () => ({ ...snapshot, position: { ...snapshot.position, debtAssetsRaw: "0", borrowSharesRaw: "0", healthFactorWad: null } }), simulateBatch: async () => {} },
      applyFee: async (_session, draft) => draft,
    });
    const zeroDebt = await withdraw(new Request("https://home.test/api/actions/prepare", { method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind: "withdraw-collateral", params: { marketId: MARKET.marketId, operation: "withdraw-collateral", amountBaseUnits: "100" } }) }));
    expect(zeroDebt.status).toBe(201);
    expect(reads).toBe(0);
  });

  test("only risk-increasing borrowing reads the offering; zero-debt collateral withdrawal is an exit", async () => {
    let debt = "0";
    let reads = 0;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      readOffering: async () => { reads++; throw new Error("db outage"); },
      borrowRpc: { readSnapshot: async () => borrowSnapshot(debt), readSnapshots: async () => [], simulateBatch: async () => {} },
      prepareBorrow: async () => { throw new Error("prepared"); },
    });
    const input = (operation: string) => new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
      body: JSON.stringify({ kind: operation === "repay-all" || operation === "close-position" ? "repay" : operation === "supply-and-borrow" ? "borrow" : operation,
        params: { marketId: MARKET.marketId, operation, ...(operation === "repay-all" || operation === "close-position" ? { maximumRepayBaseUnits: "1" } : { amountBaseUnits: "1", ...(operation === "supply-and-borrow" ? { collateralAmountBaseUnits: "1" } : {}) }) } }),
    });
    for (const operation of ["repay", "repay-all", "close-position", "supply-collateral", "withdraw-collateral"]) {
      expect((await handler(input(operation))).status).toBe(502);
      expect(reads).toBe(0);
    }
    debt = "1";
    expect((await handler(input("withdraw-collateral"))).status).toBe(409);
    expect(reads).toBe(1);
    expect((await handler(input("borrow"))).status).toBe(409);
    expect((await handler(input("supply-and-borrow"))).status).toBe(409);
    expect(reads).toBe(3);
  });

  test("refuses a stock buy before quoting even when params claim another country", async () => {
    let quoted = false;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      prepareTrade: async () => { quoted = true; throw new Error("Must not quote"); },
    });
    const response = await handler(new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded", "x-vercel-ip-country": "US" },
      body: JSON.stringify({ kind: "trade", params: { assetId: "nvdac", direction: "buy", country: "DE" } }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "TRADE_STOCK_RESTRICTED" } });
    expect(quoted).toBe(false);
  });
  test.each(["deposit", "withdraw"] as const)(
    "issues a successful savings %s action through the shared prepare route",
    async (operation) => {
      const store = new TestActionsStore();
      setActionsStoreForTests(store);
      const { inserts } = store;
      const handler = createPrepareActionHandler({
        authorize: async () => authorized(),
        prepareSavings: async () => savingsDraft(operation),
      });

      const response = await handler(request(`savings-${operation}`));
      const body = await response.json() as { kind: string; metadata: { operation: string } };

      expect(response.status).toBe(201);
      expect(body).toMatchObject({ kind: `savings-${operation}`, metadata: { operation } });
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.summary.metadata).toMatchObject({ product: "savings", operation });
    },
  );

  test("does not issue a trade when the fee policy cannot be read", async () => {
    const store = new TestActionsStore();
    setActionsStoreForTests(store);
    const handler = createPrepareActionHandler({ authorize: async () => authorized(),
      prepareTrade: async () => { throw new TradePreparationError("provider-unavailable"); } });
    const response = await handler(request("trade"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "TRADE_UNAVAILABLE" } });
    expect(store.inserts).toHaveLength(0);
  });
  test("returns a trade quote failure from the prepare handler", async () => {
    let quotes = 0;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      prepareTrade: async () => { quotes++; throw new TradePreparationError("no-liquidity"); },
    });
    const response = await handler(request("trade"));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("TRADE_ROUTE_UNAVAILABLE");
    expect(quotes).toBe(1);
  });

  test("preserves the unsupported savings vault response on the single prepare route", async () => {
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      prepareSavings: async () => {
        throw new SavingsActionError("unsupported-vault", "This vault is not supported.");
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "SAVINGS_ACTION_UNSUPPORTED",
        message: "This vault is not supported.",
      },
    });
  });

  test.each([
    ["invalid-input", 400, "SAVINGS_ACTION_INVALID"],
    ["unsupported-asset", 422, "SAVINGS_ACTION_UNSUPPORTED"],
    ["limit-exceeded", 409, "SAVINGS_ACTION_LIMIT_EXCEEDED"],
    ["rate-limited", 429, "SAVINGS_ACTION_RATE_LIMITED"],
    ["rpc", 502, "SAVINGS_ACTION_RPC"],
  ] as const)("maps savings %s to %i %s", async (reason, status, code) => {
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      prepareSavings: async () => {
        throw new SavingsActionError(reason, `savings ${reason}`);
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(status);
    expect((await response.json() as { error: { code: string } }).error.code).toBe(code);
  });

  test("rejects unknown and recognized-only send assets with 400", async () => {
    const handler = createPrepareActionHandler({ authorize: async () => authorized() });
    for (const assetId of [
      "unknown",
      "recognized:0x9999999999999999999999999999999999999999",
    ]) {
      const response = await handler(new Request("https://home.test/api/actions/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
        },
        body: JSON.stringify({
          kind: "send",
          params: {
            assetId,
            recipient: "0x2222222222222222222222222222222222222222",
            amountBaseUnits: "1",
          },
        }),
      }));
      expect(response.status).toBe(400);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("INVALID_SEND_REQUEST");
    }
  });

  test("rejects action kinds outside the stored vocabulary", async () => {
    const handler = createPrepareActionHandler({ authorize: async () => authorized() });

    const response = await handler(request(["save", "deposit"].join("-")));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_ACTION",
        message: "A valid action kind and parameters are required.",
      },
    });
  });

  test.each(["send", "savings-deposit"] as const)("prepares %s with the approved USDC fee as first call", async (kind) => {
    const store = new TestActionsStore();
    setActionsStoreForTests(store);
    const { inserts } = store;
    let feeRequest: Request | undefined;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      prepareSavings: async () => savingsDraft("deposit"),
      applyFee: async (_session, draft, options) => {
        feeRequest = options?.request;
        return { ...draft, calls: [makePaymasterApproval(BigInt(100000)), ...draft.calls], networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 } };
      },
    });
    const input = kind === "send" ? new Request("https://home.test/api/actions/prepare", { method: "POST", headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" }, body: JSON.stringify({ kind, params: { assetId: "usdc", recipient: "0x2222222222222222222222222222222222222222", amountBaseUnits: "1000000" } }) }) : request(kind);
    const response = await handler(input);
    const action = await response.json() as { calls?: Array<{ approval?: { spender: string } }>; networkFee?: { maxFeeBaseUnits: string } };
    expect(response.status).toBe(201);
    expect(feeRequest).toBe(input);
    expect(action.calls?.[0]?.approval?.spender).toBe(BASE_USDC_PAYMASTER_ADDRESS.toLowerCase());
    expect(action.networkFee?.maxFeeBaseUnits).toBe("100000");
    expect(JSON.stringify(inserts[0]?.pending.calls)).toBe(JSON.stringify(action.calls));
  });

  test.each([
    ["usdc", NETWORK_FEE_UNFUNDED_MESSAGE],
    ["eth", NETWORK_FEE_ETH_UNFUNDED_MESSAGE],
  ] as const)("reports missing %s network fee funding as HTTP 409", async (asset, message) => {
    const handler = createPrepareActionHandler({ authorize: async () => authorized(), prepareSavings: async () => savingsDraft("deposit"), applyFee: async () => { throw new NetworkFeeUnfundedError(asset); } });
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "NETWORK_FEE_UNFUNDED", message } });
  });
});
