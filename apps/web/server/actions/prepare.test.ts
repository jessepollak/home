import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { SavingsActionError } from "@/server/savings/prepare";
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
