import "server-only";

export type CardProviderName = "immersve" | "bridge";
export type CardMode = "sandbox" | "production";
export type FundingStrategy = "allowance-pull" | "deposit";
export type CardObservation = Readonly<{
  provider: CardProviderName;
  mode: CardMode;
  eventId: string;
  kind: string;
  externalIds: Readonly<{
    cardholder: string | null;
    card: string | null;
    transaction: string | null;
    customer: string | null;
  }>;
  occurredAt: string;
}>;
export type CardVerification =
  | Readonly<{ outcome: "accepted"; observation: CardObservation }>
  | Readonly<{ outcome: "rejected"; code?: "API_VERSION_MISMATCH" }>
  | Readonly<{ outcome: "stale" | "unavailable" }>;
export type CardWebhookResult = "accepted" | "rejected" | "stale" | "unavailable" | Readonly<{ outcome: "rejected"; code: "API_VERSION_MISMATCH" }>;
export type CardProvider = Readonly<{
  fundingStrategy: FundingStrategy;
  verifyAndNormalize(raw: Uint8Array, headers: Headers, topic?: string): Promise<CardVerification>;
}>;

export function createCardWebhookHandler(provider: CardProvider, store: { insert(event: CardObservation): Promise<boolean> }) {
  return async (raw: Uint8Array, headers: Headers, topic?: string): Promise<CardWebhookResult> => {
    const result = await provider.verifyAndNormalize(raw, headers, topic);
    if (result.outcome === "rejected" && result.code) return { outcome: "rejected", code: result.code };
    if (result.outcome !== "accepted") return result.outcome;
    try { await store.insert(result.observation); }
    catch { return "unavailable"; }
    return "accepted";
  };
}
