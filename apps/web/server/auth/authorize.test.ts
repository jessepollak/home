import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import { authorizeSession } from "./authorize";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function request(provider?: string): Request {
  return new Request("https://home.test/api/private", {
    headers: provider === undefined ? {} : { [ACCOUNT_PROVIDER_HEADER]: provider },
  });
}

function response(
  accountProvider: AccountProvider,
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    user: { subject: "verified-user" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider,
    ...overrides,
  });
}

describe("authorizeSession", () => {
  test("uses one provider-header rule for every private session", async () => {
    const cases = [
      { name: "missing defaults to CDP embedded", header: undefined, session: "cdp-embedded", accepted: true },
      { name: "explicit CDP embedded", header: "cdp-embedded", session: "cdp-embedded", accepted: true },
      { name: "explicit Base Account", header: "base-account", session: "base-account", accepted: true },
      { name: "missing does not accept Base Account", header: undefined, session: "base-account", accepted: false },
      { name: "provider mismatch", header: "base-account", session: "cdp-embedded", accepted: false },
      { name: "unknown provider", header: "unknown", session: "cdp-embedded", accepted: false },
    ] as const;

    for (const entry of cases) {
      const result = await authorizeSession(
        request(entry.header),
        async () => response(entry.session),
      );
      if (entry.accepted) {
        expect(result, entry.name).not.toBeInstanceOf(Response);
        expect((result as { accountProvider: string }).accountProvider, entry.name).toBe(entry.session);
      } else {
        expect(result, entry.name).toBeInstanceOf(Response);
        expect((result as Response).status, entry.name).toBe(503);
      }
    }
  });

  test("normalizes the verified address and rejects malformed successful responses", async () => {
    const accepted = await authorizeSession(
      request(),
      async () => response("cdp-embedded", {
        smartAccount: { address: ADDRESS.toUpperCase().replace("0X", "0x"), chainId: 8453 },
      }),
    );
    expect(accepted).not.toBeInstanceOf(Response);
    expect((accepted as { smartAccount: { address: string } }).smartAccount.address).toBe(ADDRESS);

    for (const body of [
      { user: { subject: "" }, smartAccount: { address: ADDRESS, chainId: 8453 }, accountProvider: "cdp-embedded" },
      { user: { subject: "verified-user" }, smartAccount: { address: ADDRESS, chainId: 1 }, accountProvider: "cdp-embedded" },
      { user: { subject: "verified-user" }, smartAccount: null, accountProvider: "base-account" },
    ]) {
      const result = await authorizeSession(request(), async () => Response.json(body));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(503);
    }
  });

  test("relays unsuccessful boundary responses unchanged", async () => {
    const failure = Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    expect(await authorizeSession(request(), async () => failure)).toBe(failure);
  });
});
