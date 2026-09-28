import "server-only";

import { CARDS_CONTRACT_VERSION, type CardsResponse, type CardState } from "@/shared/cards/contract";
import type { CardMode } from "./provider";
import type { CardAccountLink } from "./account-store";
import type { BridgeCustomer } from "./bridge/client";
import type { StripeCard } from "./stripe/client";

type Dependencies = {
  store: { read(customerId: string, mode: CardMode): Promise<CardAccountLink | null> };
  bridge: { readCustomer(id: string): Promise<BridgeCustomer> };
  stripe: {
    readCardholder(id: string): Promise<{ id: string; status: "active" | "inactive" | "blocked" }>;
    readCard(id: string): Promise<StripeCard>;
  };
  now?: () => Date;
};

export async function readCardState(customerId: string, mode: CardMode, dependencies: Dependencies): Promise<CardsResponse> {
  const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const account = await dependencies.store.read(customerId, mode);
  const reply = (state: CardState, bridge: CardsResponse["provenance"]["bridge"],
    stripe: CardsResponse["provenance"]["stripe"], cards: CardsResponse["cards"] = []): CardsResponse =>
    ({ version: CARDS_CONTRACT_VERSION, state, cards, provenance: { bridge, stripe, fetchedAt } });
  if (!account) return reply("not-enrolled", "not-requested", "not-requested");
  if (!account.bridgeCustomerId) return reply(account.cards.length ? "unavailable" : "verification-required", "not-requested", "not-requested");
  const bridgeRead = await Promise.allSettled([dependencies.bridge.readCustomer(account.bridgeCustomerId)]);
  const bridgeResult = bridgeRead[0];
  const customer = bridgeResult.status === "fulfilled" ? bridgeResult.value : null;
  const bridge = customer ? "available" : "unavailable";
  const cardholderId = customer?.stripeCardholderId ?? account.stripeCardholderId;
  if (customer && account.stripeCardholderId && customer.stripeCardholderId !== account.stripeCardholderId)
    return reply("unavailable", bridge, "not-requested");
  if (!cardholderId && account.cards.length) return reply("unavailable", bridge, "not-requested");
  const reads = await Promise.allSettled([
    ...(cardholderId ? [dependencies.stripe.readCardholder(cardholderId)] : []),
    ...account.cards.map((card) => dependencies.stripe.readCard(card.stripeCardId)),
  ]);
  const stripe = reads.length === 0 ? "not-requested" : reads.every((result) => result.status === "fulfilled") ? "available" : "unavailable";
  const holder = cardholderId && reads[0]?.status === "fulfilled" ? reads[0].value as { id: string; status: "active" | "inactive" | "blocked" } : null;
  const stripeCards = reads.slice(cardholderId ? 1 : 0).filter((result): result is PromiseFulfilledResult<StripeCard> => result.status === "fulfilled")
    .map((result) => result.value);
  if (stripeCards.some((card) => card.cardholderId !== cardholderId)) return reply("unavailable", bridge, "unavailable");
  const cards = stripeCards.map((card) => ({ id: card.id, last4: card.last4,
    status: card.status === "inactive" ? card.customerFrozen ? "frozen" as const : "restricted" as const : card.status }));
  if (!customer || stripe === "unavailable") return reply("unavailable", bridge, stripe, cards);
  const endorsement = customer.cardsEndorsement;
  if (customer.status === "inactive" || holder?.status !== undefined && holder.status !== "active" ||
      account.cards.length > 0 && (customer.status === "pending" || endorsement?.status !== "approved" || endorsement.missing || endorsement.issues || endorsement.pending))
    return reply("restricted", bridge, stripe, cards);
  if (customer.status === "rejected" || endorsement?.status === "rejected") return reply("ineligible", bridge, stripe, cards);
  if (account.cards.length) {
    if (cards.some((card) => card.status === "restricted")) return reply("restricted", bridge, stripe, cards);
    if (cards.some((card) => card.status === "canceled")) return reply("canceled", bridge, stripe, cards);
    if (cards.some((card) => card.status === "frozen")) return reply("frozen", bridge, stripe, cards);
    return reply("active", bridge, stripe, cards);
  }
  if (customer.status === "pending" || endorsement?.status === "pending" || endorsement?.pending ||
      endorsement?.status === "approved" && !customer.stripeCardholderId) return reply("verification-pending", bridge, stripe);
  if (endorsement?.status !== "approved" || endorsement.missing || endorsement.issues) return reply("verification-required", bridge, stripe);
  return reply("ready-to-issue", bridge, stripe);
}
