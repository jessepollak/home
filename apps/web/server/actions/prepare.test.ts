import { afterEach, describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { SavingsActionError } from "@/server/savings/prepare";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { setActionsStoreForTests, type ActionsStore } from "./store";
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

function savingsDraft(operation: "deposit" | "withdraw"): MoneyActionDraft {
  const deposit = operation === "deposit";
  const vault = "0x2222222222222222222222222222222222222222" as const;
  return {
    kind: deposit ? "savings-deposit" : "savings-withdraw",
    title: deposit ? "Deposit USDC" : "Withdraw USDC",
    calls: [{ to: vault, data: "0x1234", value: "0" }],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: deposit ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "1000000000000000000", direction: deposit ? "receive" : "spend", estimated: true },
    ],
    warnings: ["The wallet shows the Base network fee."],
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
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

function authorized() {
  return Response.json({
    user: { subject: "prepare-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

afterEach(() => setActionsStoreForTests(null));

describe("prepare action handler", () => {
  test.each(["deposit", "withdraw"] as const)(
    "issues a successful savings %s action through the shared prepare route",
    async (operation) => {
      const inserts: Array<Parameters<ActionsStore["insert"]>[0]> = [];
      setActionsStoreForTests({
        insert: async (input: Parameters<ActionsStore["insert"]>[0]) => { inserts.push(input); },
      } as ActionsStore);
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
});
