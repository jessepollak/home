import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { SavingsActionError } from "@/server/savings/prepare";
import { LendPreparationError } from "@/server/lending/prepare";
import { DEFAULT_VERIFIED_MORPHO_MARKET, type VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import type { MorphoMarketRpcReader, MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";
import { createPrepareActionHandler } from "./prepare";

const OWNER = "0x1111111111111111111111111111111111111111";

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
        vaultAddress: "0x2222222222222222222222222222222222222222",
        amountBaseUnits: "1000000",
      },
    }),
  });
}

function lendRequest(kind: "lend-supply" | "lend-withdraw", operation: "supply" | "withdraw" | "withdraw-all", amountBaseUnits?: string) {
  return new Request("https://home.test/api/actions/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" },
    body: JSON.stringify({ kind, params: { marketId: DEFAULT_VERIFIED_MORPHO_MARKET.marketId, operation, ...(amountBaseUnits ? { amountBaseUnits } : {}) } }),
  });
}

function morphoSnapshot(wallet: Partial<MorphoMarketSnapshot["wallet"]> = {}): MorphoMarketSnapshot {
  const market = DEFAULT_VERIFIED_MORPHO_MARKET;
  return {
    chainId: 8453, walletAddress: OWNER as `0x${string}`,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    capabilities: market.capabilities,
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789329600", fetchedAt: "2026-09-14T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "0", borrowAprWad: "0", totalSupplyAssetsRaw: "2", totalSupplySharesRaw: "2", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "1", feeWad: "0", utilizationWad: "500000000000000000", supplyAprWad: "0", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "0", collateralAllowanceRaw: "0", loanAllowanceRaw: "0", ...wallet },
    position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableSupplyAssetsRaw: "0", collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", availableBorrowAssetsRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
  };
}

function morphoRpc(next = morphoSnapshot()): MorphoMarketRpcReader {
  return { readSnapshot: async () => next, simulateBatch: async () => {} };
}

function authorized() {
  return Response.json({
    user: { subject: "prepare-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

describe("prepare action handler", () => {
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

  test("rejects lend action kind and operation mismatches before reading chain state", async () => {
    let reads = 0;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      morphoRpc: { readSnapshot: async () => { reads += 1; return morphoSnapshot(); }, simulateBatch: async () => {} },
    });

    const response = await handler(lendRequest("lend-supply", "withdraw", "1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "LEND_INVALID_INPUT", message: "The lending operation or exact base-unit amount is invalid." } });
    expect(reads).toBe(0);
  });

  test.each([
    ["invalid-input", 400, "LEND_INVALID_INPUT"],
    ["unsupported-market", 400, "LEND_UNSUPPORTED_MARKET"],
    ["limit-exceeded", 409, "LEND_LIMIT_EXCEEDED"],
    ["simulation-failed", 502, "LEND_SIMULATION_FAILED"],
  ] as const)("maps Lend %s to %i %s", async (reason, status, code) => {
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      morphoRpc: morphoRpc(),
      prepareLend: async () => { throw new LendPreparationError(reason, `lend ${reason}`); },
    });

    const response = await handler(lendRequest("lend-supply", "supply", "1"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: `lend ${reason}` } });
  });

  test("prepares and issues a lend-only verified market through the generic engine", async () => {
    const lendOnlyMarket = { ...DEFAULT_VERIFIED_MORPHO_MARKET, capabilities: { lend: "enabled" } } as const satisfies VerifiedMorphoMarketRef;
    const snapshot = morphoSnapshot({ loanBalanceRaw: "10", loanAllowanceRaw: "1" });
    snapshot.capabilities = lendOnlyMarket.capabilities;
    const issuedKinds: string[] = [];
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      getMorphoMarket: () => lendOnlyMarket,
      morphoRpc: morphoRpc(snapshot),
      issue: async (ownerSession, draft) => {
        issuedKinds.push(draft.kind);
        return {
          ...draft,
          id: "11111111-1111-4111-8111-111111111111",
          owner: { subject: ownerSession.user.subject, address: OWNER as `0x${string}`, chainId: 8453, accountProvider: ownerSession.accountProvider },
          createdAt: "2026-09-14T12:00:00.000Z",
        };
      },
    });

    const response = await handler(lendRequest("lend-supply", "supply", "1"));

    expect(response.status).toBe(201);
    expect((await response.json() as { kind: string }).kind).toBe("lend-supply");
    expect(issuedKinds).toEqual(["lend-supply"]);
  });

  test("maps verified Lend wallet-balance limits without issuing an action", async () => {
    let issued = false;
    const handler = createPrepareActionHandler({
      authorize: async () => authorized(),
      morphoRpc: morphoRpc(morphoSnapshot({ loanBalanceRaw: "0" })),
      issue: async () => { issued = true; throw new Error("must not issue"); },
    });

    const response = await handler(lendRequest("lend-supply", "supply", "1"));

    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("LEND_LIMIT_EXCEEDED");
    expect(issued).toBe(false);
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
});
