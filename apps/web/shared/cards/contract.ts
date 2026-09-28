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
export type CardWriteErrorCode = "CARDS_UNAVAILABLE" | "CARD_NOT_READY" | "CARD_CONFLICT" | "CARD_NOT_FOUND" | "INVALID_CARD_REQUEST" | "CROSS_ORIGIN";
export type CardWriteError = Readonly<{ version: typeof CARDS_CONTRACT_VERSION; error: Readonly<{ code: CardWriteErrorCode }> }>;
export type CardEnrollmentResponse = Readonly<{ version: typeof CARDS_CONTRACT_VERSION; kycUrl: string }>;
export type CardWriteResponse = Readonly<{ version: typeof CARDS_CONTRACT_VERSION; card: Readonly<{ id: string; status: "active" | "frozen" }> }>;

export function parseCardEnrollmentResponse(value: unknown): CardEnrollmentResponse | null {
  if (typeof value !== "object" || !value || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.version !== CARDS_CONTRACT_VERSION || typeof response.kycUrl !== "string") return null;
  try {
    const url = new URL(response.kycUrl);
    if (url.protocol !== "https:" || url.hostname !== "bridge.withpersona.com" || url.username || url.password || url.hash) return null;
  } catch { return null; }
  return response as CardEnrollmentResponse;
}

export function parseCardWriteResponse(value: unknown): CardWriteResponse | null {
  if (typeof value !== "object" || !value || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.version !== CARDS_CONTRACT_VERSION || typeof response.card !== "object" || !response.card || Array.isArray(response.card)) return null;
  const card = response.card as Record<string, unknown>;
  return typeof card.id === "string" && /^ic_[A-Za-z0-9]+$/.test(card.id) &&
    (card.status === "active" || card.status === "frozen") ? response as CardWriteResponse : null;
}

export function parseCardWriteError(value: unknown): CardWriteError | null {
  if (typeof value !== "object" || !value || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.version !== CARDS_CONTRACT_VERSION || typeof response.error !== "object" || !response.error || Array.isArray(response.error)) return null;
  return ["CARDS_UNAVAILABLE", "CARD_NOT_READY", "CARD_CONFLICT", "CARD_NOT_FOUND", "INVALID_CARD_REQUEST", "CROSS_ORIGIN"].includes(String((response.error as Record<string, unknown>).code)) ? response as CardWriteError : null;
}

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
