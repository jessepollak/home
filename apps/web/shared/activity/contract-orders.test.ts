import { expect, test } from "bun:test";
import { parseActivityOrders } from "./contract-orders";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

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
