import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { activityOrdersFixture } from "@/tests/browser/feature-map/fixtures";
import { parseActivityOrders } from "./contract-orders";

function fixtureSession(subject: string): VerifiedAccountSession {
  return { user: { subject }, accountProvider: "cdp-embedded", smartAccount: null };
}

test("parses all five feature-map orders without changing their fields", () => {
  const fixture = activityOrdersFixture();
  const orders = parseActivityOrders(fixture, fixtureSession(fixture.owner.subject));
  expect(orders.map(({ id, kind, status }) => [id, kind, status])).toEqual([
    ["fixture-funding-pending", "funding", "waiting-customer"],
    ["fixture-funding-processing", "funding", "waiting-provider"],
    ["fixture-funding-received", "funding", "confirmed"],
    ["fixture-funding-ambiguous", "funding", "ambiguous"],
    ["90100000-0000-4000-8000-000000000001", "cash-out", "waiting-provider"],
  ]);
  expect(orders).toEqual(fixture.orders);
});

test("strips unknown envelope, owner, order, and asset keys", () => {
  const fixture = activityOrdersFixture();
  const first = fixture.orders[0];
  if (!first || first.kind !== "funding") throw new Error("Expected a funding fixture order");
  const parsed = parseActivityOrders({
    ...fixture,
    extra: "ignored",
    owner: { ...fixture.owner, extra: "ignored" },
    orders: [{ ...first, extra: "ignored", asset: { ...first.asset, extra: "ignored" } }, ...fixture.orders.slice(1)],
  }, fixtureSession(fixture.owner.subject));
  expect(parsed).toEqual(fixture.orders);
  expect(parsed[0]).not.toHaveProperty("extra");
  if (parsed[0]?.kind !== "funding") throw new Error("Expected a funding order");
  expect(parsed[0].asset).not.toHaveProperty("extra");
});

const session: VerifiedAccountSession = { user: { subject: "owner" }, smartAccount: null, accountProvider: "cdp-embedded" };
const order = {
  kind: "funding", id: "1", region: "US", providerId: "provider", providerName: "Provider", paymentMethodLabel: "Card",
  status: "confirmed", stage: "received", instruction: null, resumable: false, fiatAmount: "1", fiatCurrency: "USD",
  asset: { id: "usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "1000000", sandbox: false,
  expiresAt: null, clearableAt: null, logIndex: "1", createdAt: "2026-09-25T12:00:00Z", updatedAt: "2026-09-25T12:00:00Z",
};

test("funding orders canonicalize mixed-case transaction hashes and omit invalid rows", () => {
  const parse = (transactionHash: string) => parseActivityOrders({ version: 1, owner: { subject: "owner", accountProvider: "cdp-embedded" }, orders: [{ ...order, transactionHash }] }, session);
  const parsed = parse(`0x${"Ab".repeat(32)}`)[0];
  expect(String(parsed?.kind === "funding" ? parsed.transactionHash : null)).toBe(`0x${"ab".repeat(32)}`);
  for (const hash of ["0x1234", `0x${"zz".repeat(32)}`]) expect(parse(hash)).toEqual([]);
});
