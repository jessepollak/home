import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { MoneyActionIssueError } from "@/server/money-actions/issue";
import { MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import { createSavingsActionsHandler } from "./handler";
import { SavingsActionError } from "./prepare";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[0];

function session(
  accountProvider: VerifiedAccountSession["accountProvider"],
): VerifiedAccountSession {
  return {
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider,
  };
}

function authorize(accountProvider: VerifiedAccountSession["accountProvider"]) {
  return async () => Response.json(session(accountProvider));
}

function savingsRequest(
  provider: VerifiedAccountSession["accountProvider"],
  body: Record<string, unknown> = {
    kind: "deposit",
    vaultAddress: VAULT,
    amountBaseUnits: "5000000",
  },
) {
  return new Request("https://home.test/api/savings/actions", {
    method: "POST",
    headers: {
      authorization: "Bearer aaa.bbb.ccc",
      "content-type": "application/json",
      "X-Home-Account-Provider": provider,
    },
    body: JSON.stringify(body),
  });
}

function issuedAction(accountProvider: VerifiedAccountSession["accountProvider"]) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "save-deposit" as const,
    title: "Deposit USDC into Morpho",
    reviewHash: "a".repeat(64),
    owner: {
      subject: "subject-a",
      address: ADDRESS,
      chainId: 8453 as const,
      accountProvider,
    },
    calls: [],
    amounts: [],
    warnings: [],
    createdAt: "2026-09-08T21:13:00.000Z",
    expiresAt: "2026-09-08T21:18:00.000Z",
  };
}

describe("savings action handler", () => {
  test("prepares for both email CDP and Base Account sessions", async () => {
    for (const provider of ["cdp-embedded", "base-account"] as const) {
      let preparedProvider: string | undefined;
      const handler = createSavingsActionsHandler({
        authorize: authorize(provider),
        prepare: async ({ session: verified }) => {
          preparedProvider = verified.accountProvider;
          return {
            kind: "save-deposit",
            title: "Deposit USDC into Morpho",
            calls: [{ to: VAULT, data: "0x1234", value: "0" }],
            amounts: [{
              assetId: "usdc",
              symbol: "USDC",
              decimals: 6,
              amountBaseUnits: "5000000",
              direction: "spend",
            }],
            warnings: ["Prepared."],
            expiresAt: "2026-09-08T21:18:00.000Z",
          };
        },
        issue: async (verified) => issuedAction(verified.accountProvider),
      });

      const response = await handler(savingsRequest(provider));
      expect(preparedProvider).toBe(provider);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        kind: "save-deposit",
        owner: { accountProvider: provider, address: ADDRESS },
      });
    }
  });

  test("returns the RPC error code instead of the opaque unavailable copy", async () => {
    const handler = createSavingsActionsHandler({
      authorize: authorize("cdp-embedded"),
      prepare: async () => {
        throw new SavingsActionError(
          "rpc",
          "Base RPC rejected a savings state read: execution reverted",
        );
      },
      issue: async () => issuedAction("cdp-embedded"),
    });

    const response = await handler(savingsRequest("cdp-embedded"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "SAVINGS_ACTION_RPC",
        message: "Base RPC rejected a savings state read: execution reverted",
      },
    });
  });

  test("maps issue failures and unknown throws to distinct safe codes", async () => {
    const issueHandler = createSavingsActionsHandler({
      authorize: authorize("base-account"),
      prepare: async () => ({
        kind: "save-deposit",
        title: "Deposit USDC into Morpho",
        calls: [{ to: VAULT, data: "0x1234", value: "0" }],
        amounts: [{
          assetId: "usdc",
          symbol: "USDC",
          decimals: 6,
          amountBaseUnits: "5000000",
          direction: "spend",
        }],
        warnings: ["Prepared."],
        expiresAt: "2026-09-08T21:18:00.000Z",
      }),
      issue: async () => {
        throw new MoneyActionIssueError("invalid-draft");
      },
    });
    const issueResponse = await issueHandler(savingsRequest("base-account"));
    expect(issueResponse.status).toBe(502);
    expect(await issueResponse.json()).toEqual({
      error: {
        code: "SAVINGS_ACTION_ISSUE",
        message: "The savings review could not be stored for this account.",
      },
    });

    const unknownHandler = createSavingsActionsHandler({
      authorize: authorize("cdp-embedded"),
      prepare: async () => {
        throw new Error("secret stack");
      },
      issue: async () => issuedAction("cdp-embedded"),
    });
    const unknownResponse = await unknownHandler(savingsRequest("cdp-embedded"));
    expect(unknownResponse.status).toBe(502);
    expect(await unknownResponse.json()).toEqual({
      error: {
        code: "SAVINGS_ACTION_UNAVAILABLE",
        message: "Savings action preparation is temporarily unavailable.",
      },
    });
  });
});
