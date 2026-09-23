import { balancesSnapshot } from "../tests/browser/balances-fixtures";

const owner = "0x1111111111111111111111111111111111111111";
const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  return [
    ["**/api/session", {
      user: { subject: "verify-fixture-subject" },
      smartAccount: { address: owner, chainId: 8453 },
      accountProvider: "cdp-embedded",
    }],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", { actions: [] }],
    ["**/api/activity**", {}],
    ["**/api/borrow**", {}],
    ["**/api/client-performance", { ok: true }],
    ["**/api/funding/providers**", { providers: [] }],
    ["**/api/funding/offramp/orders**", { version: 3, recoveryEligible: false, orders: [] }],
    ["**/api/transfers/recipient-name**", { version: 1, name: "jesse.base.eth", address: recentRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1,
      recipients: [{ address: recentRecipient, name: "jesse.base.eth" }],
    }],
    ["**/api/basename-profile**", { profile: null }],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}
