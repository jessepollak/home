import { balancesSnapshot } from "../tests/browser/balances-fixtures";

const owner = "0x1111111111111111111111111111111111111111";

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
    ["**/api/basename-profile**", { profile: null }],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}
