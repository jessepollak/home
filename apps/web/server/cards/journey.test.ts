import { describe, expect, test } from "bun:test";
import { readCardState } from "./journey";
import type { CardAccountLink } from "./account-store";
import type { BridgeCustomer } from "./bridge/client";
import type { StripeCard } from "./stripe/client";
import type { CardState } from "@/shared/cards/contract";

const account: CardAccountLink = { bridgeCustomerId: "bridge-id", stripeCardholderId: "ich_123",
  cards: [{ id: "local", stripeCardId: "ic_123", walletAddress: "0x1111111111111111111111111111111111111111" }] };
const bridge: BridgeCustomer = { id: "bridge-id", status: "active", stripeCardholderId: "ich_123",
  cardsEndorsement: { status: "approved", missing: false, pending: false, issues: false } };
const card: StripeCard = { id: "ic_123", cardholderId: "ich_123", status: "active", last4: "1234", customerFrozen: false };

function deps(options: { account?: CardAccountLink | null; bridge?: BridgeCustomer | null; card?: StripeCard | null;
  holder?: "active" | "inactive" | "blocked" | null } = {}) {
  return { store: { read: async (_customerId: string, _mode: "sandbox" | "production") => options.account === undefined ? account : options.account },
    bridge: { readCustomer: async (_id: string) => { if (options.bridge === null) throw new Error("down"); return options.bridge ?? bridge; } },
    stripe: { readCardholder: async (_id: string) => { if (options.holder === null) throw new Error("down"); return { id: "ich_123", status: options.holder ?? "active" as const }; },
      readCard: async (_id: string) => { if (options.card === null) throw new Error("down"); return options.card ?? card; } },
    now: () => new Date("2026-09-28T12:00:00Z") };
}
const state = (options?: Parameters<typeof deps>[0]) => readCardState("owner", "sandbox", deps(options));

describe("card state precedence and availability", () => {
  test("no account makes no provider reads", async () => {
    let calls = 0;
    const counted = deps({ account: null });
    const result = await readCardState("owner", "sandbox", { ...counted,
      bridge: { readCustomer: async (id: string) => { calls += 1; return counted.bridge.readCustomer(id); } },
      stripe: { readCardholder: async (id: string) => { calls += 1; return counted.stripe.readCardholder(id); },
        readCard: async (id: string) => { calls += 1; return counted.stripe.readCard(id); } } });
    expect(result.state).toBe("not-enrolled");
    expect(calls).toBe(0);
  });
  test("a replacement card is active while its canceled predecessor is ignored", async () => {
    const replaced = { ...account, cards: [{ id: "old", stripeCardId: "ic_old", walletAddress: account.cards[0]!.walletAddress }, account.cards[0]!] };
    const both = deps({ account: replaced });
    const readCard = async (id: string): Promise<StripeCard> => id === "ic_old" ? { ...card, id, status: "canceled" } : card;
    expect((await readCardState("owner", "sandbox", { ...both, stripe: { ...both.stripe, readCard } })).state).toBe("active");
    const allCanceled = async (id: string): Promise<StripeCard> => ({ ...card, id, status: "canceled" });
    expect((await readCardState("owner", "sandbox", { ...both, stripe: { ...both.stripe, readCard: allCanceled } })).state).toBe("canceled");
  });
  test("a reserved account requires verification", async () => {
    expect((await state({ account: { ...account, bridgeCustomerId: null, cards: [] } })).state).toBe("verification-required");
  });
  test("every documented Bridge customer status before and after issue", async () => {
    const cases: Array<[BridgeCustomer["status"], CardState, CardState]> = [
      ["not_started", "verification-required", "restricted"],
      ["incomplete", "verification-required", "restricted"],
      ["awaiting_questionnaire", "verification-required", "restricted"],
      ["awaiting_ubo", "verification-required", "restricted"],
      ["under_review", "verification-pending", "restricted"],
      ["active", "ready-to-issue", "active"],
      ["rejected", "ineligible", "restricted"],
      ["paused", "restricted", "restricted"],
      ["offboarded", "ineligible", "restricted"],
      ["deposits_restricted", "restricted", "restricted"],
    ];
    for (const [status, before, after] of cases) {
      expect((await state({ account: { ...account, cards: [] }, bridge: { ...bridge, status } })).state).toBe(before);
      expect((await state({ bridge: { ...bridge, status } })).state).toBe(after);
    }
  });
  test("endorsement requirements and cardholder restrictions win over issued-card state", async () => {
    const noCards = { ...account, cards: [] };
    expect((await state({ account: noCards, bridge: { ...bridge, cardsEndorsement: { status: "revoked", missing: false, pending: false, issues: false } } })).state).toBe("verification-required");
    expect((await state({ account: noCards, bridge: { ...bridge, cardsEndorsement: { status: "incomplete", missing: false, pending: true, issues: false } } })).state).toBe("verification-pending");
    expect((await state({ account: noCards, bridge: { ...bridge, cardsEndorsement: { status: "incomplete", missing: true, pending: false, issues: true } } })).state).toBe("verification-required");
    expect((await state({ bridge: { ...bridge, status: "paused" }, card: { ...card, status: "canceled" } })).state).toBe("restricted");
    expect((await state({ holder: "inactive", card: { ...card, status: "inactive", customerFrozen: true } })).state).toBe("restricted");
    expect((await state({ bridge: { ...bridge, cardsEndorsement: { status: "revoked", missing: true, pending: false, issues: false } } })).state).toBe("restricted");
  });
  test("canceled > customer frozen > active; inactive without exact marker is restricted", async () => {
    expect((await state()).state).toBe("active");
    expect((await state({ card: { ...card, status: "canceled" } })).state).toBe("canceled");
    expect((await state({ card: { ...card, status: "inactive", customerFrozen: true } })).state).toBe("frozen");
    expect((await state({ card: { ...card, status: "inactive", customerFrozen: false } })).state).toBe("restricted");
  });
  test("one provider down never yields an authoritative active or ready state", async () => {
    const bridgeDown = await state({ bridge: null });
    expect(bridgeDown.state).toBe("unavailable");
    expect(bridgeDown.provenance).toEqual({ bridge: "unavailable", stripe: "available", fetchedAt: "2026-09-28T12:00:00.000Z" });
    expect(bridgeDown.cards).toHaveLength(1);
    const stripeDown = await state({ card: null });
    expect(stripeDown.state).toBe("unavailable");
    expect(stripeDown.provenance.stripe).toBe("unavailable");
    expect((await state({ holder: null })).state).toBe("unavailable");
    expect((await state({ bridge: { ...bridge, stripeCardholderId: "ich_other" } })).state).toBe("unavailable");
  });
});
