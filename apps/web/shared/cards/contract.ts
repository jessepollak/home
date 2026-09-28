export const CARDS_CONTRACT_VERSION = 1 as const;

export type CardState = "not-enrolled" | "verification-required" | "verification-pending" | "ineligible" |
  "ready-to-issue" | "active" | "frozen" | "restricted" | "canceled" | "unavailable";
export type CardSource = "available" | "unavailable" | "not-requested";
export type CardsResponse = Readonly<{
  version: typeof CARDS_CONTRACT_VERSION;
  state: CardState;
  cards: ReadonlyArray<Readonly<{ id: string; status: "active" | "frozen" | "restricted" | "canceled"; last4: string }>>;
  provenance: Readonly<{ bridge: CardSource; stripe: CardSource; fetchedAt: string }>;
}>;
export type CardsError = Readonly<{ version: typeof CARDS_CONTRACT_VERSION; error: Readonly<{ code: "CARDS_UNAVAILABLE" }> }>;

export function parseCardsResponse(value: unknown): CardsResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.version !== CARDS_CONTRACT_VERSION ||
      !["not-enrolled", "verification-required", "verification-pending", "ineligible", "ready-to-issue", "active", "frozen", "restricted", "canceled", "unavailable"].includes(String(response.state)) ||
      !Array.isArray(response.cards) || !response.cards.every((card: unknown) => {
        if (typeof card !== "object" || !card || Array.isArray(card)) return false;
        const item = card as Record<string, unknown>;
        return typeof item.id === "string" && /^ic_[A-Za-z0-9]+$/.test(item.id) &&
          ["active", "frozen", "restricted", "canceled"].includes(String(item.status)) &&
          typeof item.last4 === "string" && /^\d{4}$/.test(item.last4);
      }) || typeof response.provenance !== "object" || !response.provenance || Array.isArray(response.provenance)) return null;
  const source = response.provenance as Record<string, unknown>;
  if (!["available", "unavailable", "not-requested"].includes(String(source.bridge)) ||
      !["available", "unavailable", "not-requested"].includes(String(source.stripe)) ||
      typeof source.fetchedAt !== "string" || !Number.isFinite(Date.parse(source.fetchedAt))) return null;
  return response as CardsResponse;
}
