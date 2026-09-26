import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TradePreparationError } from "./permit2";
import { createTradeAvailabilityHandler } from "./availability";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const session: VerifiedAccountSession = {
  user: { subject: "owner" }, smartAccount: { address: ACCOUNT, chainId: 8453 }, accountProvider: "base-account",
};
const request = () => new Request("https://home.test/api/trades", { headers: { "X-Home-Account-Provider": "base-account" } });

describe("trade availability", () => {
  test.each([
    ["provider-unconfigured", {}, session, false],
    ["account-unavailable", { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }, { ...session, smartAccount: null }, false],
    ["signer-unsupported", { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }, session, true],
    ["available", { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }, session, false],
  ] as const)("responds %s without exposing credentials", async (expected, env, active, unsupported) => {
    const handler = createTradeAvailabilityHandler({
      env, authorize: async () => active as VerifiedAccountSession,
      resolveSigner: async () => {
        if (unsupported) throw new TradePreparationError("signer-unsupported");
        return { smartAccount: ACCOUNT, signerAddress: ACCOUNT, ownerIndex: 0, deployed: true };
      },
    });
    const response = await handler(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(body).toEqual(expected === "available" ? { version: 1, status: "available" } : { version: 1, status: "unavailable", reason: expected });
  });

  test("preserves authentication denial", async () => {
    const handler = createTradeAvailabilityHandler({ authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) });
    expect((await handler(request())).status).toBe(401);
  });
  test("rejects a signer resolved for a different account", async () => {
    const handler = createTradeAvailabilityHandler({
      env: { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }, authorize: async () => session,
      resolveSigner: async () => ({ smartAccount: "0x2222222222222222222222222222222222222222", signerAddress: ACCOUNT, ownerIndex: 0, deployed: true }),
    });
    expect(await (await handler(request())).json()).toEqual({ version: 1, status: "unavailable", reason: "signer-unsupported" });
  });
});
