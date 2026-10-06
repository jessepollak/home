import { expect, test } from "bun:test";
import { reduceCardState, readCardState } from "./journey";
import type { CardAccountLink } from "./account-store";
import type { ProgramAccount, ProgramCardRead } from "./program";
import { fakeProgram } from "@/tests/cards/fake-program";

const link: CardAccountLink = { customerId: "owner", mode: "sandbox", provider: "bridge", accountId: "account", cardholderId: "holder",
  cards: [{ id: "11111111-1111-4111-8111-111111114821", providerCardId: "ic_fixture", walletAddress: "0x1111111111111111111111111111111111111111" }] };
const account = (status: ProgramAccount["status"]): ProgramAccount => ({ status, cardholderId: "holder", link: {} });
const read = (status: "active" | "frozen" | "restricted" | "canceled"): ProgramCardRead => ({ providerCardId: "ic_fixture", ok: true,
  card: { providerCardId: "ic_fixture", cardholderId: "holder", status, last4: "4821" } });
const empty = { ...link, cards: [] };
test.each([
  ["row 1", null, null, [], "not-enrolled"],
  ["row 2 empty", { ...empty, accountId: null }, null, [], "verification-required"],
  ["row 2 linked", { ...link, accountId: null }, null, [], "unavailable"],
  ["row 3 account", link, account("unavailable"), [read("active")], "unavailable"],
  ["row 3 partial", link, account("ready"), [{ providerCardId: "ic_fixture", ok: false }], "unavailable"],
  ["row 3 holder", link, { ...account("ready"), cardholderId: "other" }, [read("active")], "unavailable"],
  ["row 4", empty, account("ineligible"), [], "ineligible"],
  ["row 5 account", empty, account("restricted"), [], "restricted"],
  ["row 5 linked", link, account("ineligible"), [read("active")], "restricted"],
  ["row 6 canceled", link, account("ready"), [read("canceled")], "canceled"],
  ["row 6 restricted", link, account("ready"), [read("restricted")], "restricted"],
  ["row 6 frozen", link, account("ready"), [read("frozen")], "frozen"],
  ["row 6 active", link, account("ready"), [read("active")], "active"],
  ["row 7 required", empty, account("verification-required"), [], "verification-required"],
  ["row 7 pending", empty, account("verification-pending"), [], "verification-pending"],
  ["row 8", empty, account("ready"), [], "ready-to-issue"],
] as const)("card ladder %s", (_name, row, observation, reads, expected) => {
  expect(reduceCardState(row, observation, reads)).toBe(expected);
});
test("failed account and partial card reads retain successfully read owned UUID cards", async () => {
  const fake = fakeProgram({ readAccount: async () => { throw new DOMException("timeout", "TimeoutError"); }, readCards: async () => [read("active")] });
  const result = await readCardState("owner", "sandbox", { store: { read: async () => link }, programFor: async () => fake.program,
    now: () => new Date("2026-10-06T00:00:00Z") });
  expect(result.state).toBe("unavailable"); expect(result.cards[0]?.id).toBe("11111111-1111-4111-8111-111111114821");
  expect(result.provenance.account).toBe("unavailable");
});
