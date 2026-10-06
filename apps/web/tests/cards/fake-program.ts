import type { CardProgram, ProgramAccount, ProgramCard, ProgramPurchase } from "@/server/cards/program";
import { BASE_USDC } from "@/shared/assets/base";

export function fakeProgram(options: Partial<CardProgram> = {}) {
  const calls: { purpose: string; key: string }[] = [];
  const cards = new Map<string, ProgramCard>();
  const issuedKeys = new Map<string, string>();
  const account: ProgramAccount = { status: "ready", cardholderId: "holder-fixture", link: { cardholderId: "holder-fixture" } };
  const purchases = new Map<string, ProgramPurchase>();
  const program: CardProgram = {
    provider: "bridge", mode: "sandbox", funding: { strategy: "allowance-pull", chainId: 8453, token: BASE_USDC,
      spender: "0x3333333333333333333333333333333333333333", retired: [], maximumBaseUnits: "100000000", prerequisitesMet: true },
    enrollmentHosts: ["bridge.withpersona.com"], events: [],
    readAccount: async () => account,
    readCards: async (_link, ids) => ids.map((id) => { const card = cards.get(id); return card ? { providerCardId: id, ok: true, card } : { providerCardId: id, ok: false }; }),
    enroll: async (_link, request) => { calls.push({ purpose: "enroll", key: request.idempotencyKey });
      return { link: { accountId: "account-fixture", cardholderId: account.cardholderId }, next: { kind: "redirect", url: "https://bridge.withpersona.com/inquiry" } }; },
    issue: async (_link, _wallet, key) => {
      calls.push({ purpose: "issue", key });
      const prior = issuedKeys.get(key);
      if (prior) { const card = cards.get(prior); if (card) return card; }
      const id = `ic_fixture${issuedKeys.size + 1}`;
      issuedKeys.set(key, id);
      const card: ProgramCard = { providerCardId: id, cardholderId: account.cardholderId, status: "active", last4: "4821" };
      cards.set(id, card); return card;
    },
    setFrozen: async (_link, id, frozen, key) => {
      calls.push({ purpose: "freeze", key });
      const card = cards.get(id); if (!card) throw new Error("Missing card");
      const next = { ...card, status: frozen ? "frozen" as const : "active" as const }; cards.set(id, next); return next;
    },
    reveal: async (_link, issuingCard, request) => request.step === "prepare" ? { method: request.method, step: request.step, issuingCard } :
      { method: request.method, step: request.step, issuingCard, nonce: request.nonce, ephemeralKeySecret: "ek_test_synthetic123456" },
    purchases: {
      read: async (ref) => { const row = purchases.get(ref.id); if (!row) throw new Error("Purchase unavailable"); return row; },
      list: async (id, since) => ({ rows: [...purchases.values()].filter((row) => row.cardId === id && new Date(row.createdAt) >= since), partial: false }),
      refFor: (event) => event.externalIds.transaction ? { id: event.externalIds.transaction, kind: "authorization" } : null,
    },
    ...options,
  };
  return { program, account, cards, purchases, calls };
}
