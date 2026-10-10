import "server-only";

import { CARDS_CONTRACT_VERSION, type CardsResponse, type CardState } from "@/shared/cards/contract";
import type { CardMode } from "./provider";
import type { CardAccountLink } from "./account-store";
import type { CardProgram, ProgramAccount, ProgramCardRead } from "./program";

export function reduceCardState(link: CardAccountLink | null, account: ProgramAccount | null, reads: readonly ProgramCardRead[]): CardState {
  if (!link) return "not-enrolled";
  if (!link.accountId) return link.cards.length ? "unavailable" : "verification-required";
  const holder = account?.cardholderId ?? link.cardholderId;
  if (!account || account.status === "unavailable" || reads.length !== link.cards.length ||
      reads.some((read) => !read.ok || read.card.providerCardId !== read.providerCardId || read.card.cardholderId !== holder) ||
      link.cards.some((card) => reads.filter((read) => read.providerCardId === card.providerCardId).length !== 1)) return "unavailable";
  if (!link.cards.length && account.status === "ineligible") return "ineligible";
  if (account.status === "restricted" || link.cards.length && account.status !== "ready") return "restricted";
  if (link.cards.length) {
    const cards = reads.flatMap((read) => read.ok ? [read.card] : []);
    if (cards.every((card) => card.status === "canceled")) return "canceled";
    if (cards.some((card) => card.status === "restricted")) return "restricted";
    if (cards.some((card) => card.status === "frozen")) return "frozen";
    return "active";
  }
  if (account.status === "verification-pending" || account.status === "verification-required") return account.status;
  return "ready-to-issue";
}

export async function readCardState(customerId: string, mode: CardMode, dependencies: {
  store: { read(customerId: string, mode: CardMode, signal?: AbortSignal): Promise<CardAccountLink | null> };
  programFor: (customerId: string, mode: CardMode, signal?: AbortSignal) => Promise<CardProgram | null>;
  now?: () => Date;
}, signal?: AbortSignal): Promise<CardsResponse> {
  const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
  signal?.throwIfAborted();
  const link = await dependencies.store.read(customerId, mode, signal);
  const program = await dependencies.programFor(customerId, mode, signal);
  signal?.throwIfAborted();
  const reply = (state: CardState, account: CardsResponse["provenance"]["account"], cards: CardsResponse["provenance"]["cards"], reads: readonly ProgramCardRead[] = []): CardsResponse => ({
    version: CARDS_CONTRACT_VERSION, state, cards: reads.flatMap((read) => {
      const owned = link?.cards.find((card) => card.providerCardId === read.providerCardId);
      return read.ok && owned ? [{ id: owned.id, last4: read.card.last4, status: read.card.status }] : [];
    }), provenance: { program: link?.provider ?? program?.provider ?? null, account, cards, fetchedAt },
  });
  if (!program || link && (program.provider !== link.provider || program.mode !== mode)) return reply("unavailable", "unavailable", "not-requested");
  if (!link) return reply("not-enrolled", "not-requested", "not-requested");
  if (!link.accountId) return reply(reduceCardState(link, null, []), "not-requested", "not-requested");
  const [accountResult, cardsResult] = await Promise.allSettled([
    program.readAccount(link, signal), program.readCards(link, link.cards.map((card) => card.providerCardId), signal),
  ]);
  signal?.throwIfAborted();
  const account = accountResult.status === "fulfilled" ? accountResult.value : null;
  const reads = cardsResult.status === "fulfilled" ? cardsResult.value : [];
  const state = reduceCardState(link, account, reads);
  return reply(state, account && account.status !== "unavailable" ? "available" : "unavailable",
    link.cards.length === 0 ? "not-requested" : reads.length === link.cards.length && reads.every((read) => read.ok) ? "available" : "unavailable", reads);
}
