import "server-only";

import type { CardJourneyConfig } from "./journey-config";

export type BridgeCustomer = Readonly<{
  id: string;
  status: "active" | "inactive" | "pending" | "rejected";
  stripeCardholderId: string | null;
  cardsEndorsement: Readonly<{
    status: "approved" | "pending" | "incomplete" | "rejected" | "revoked";
    missing: boolean;
    pending: boolean;
    issues: boolean;
  }> | null;
}>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Invalid Bridge response");
  return value as Record<string, unknown>;
}

export function parseBridgeCustomer(value: unknown): BridgeCustomer {
  const item = object(value);
  if (typeof item.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.id) ||
      !["active", "inactive", "pending", "rejected"].includes(String(item.status)) ||
      !(item.stripe_cardholder_id === null || item.stripe_cardholder_id === undefined ||
        typeof item.stripe_cardholder_id === "string" && /^ich_[A-Za-z0-9]+$/.test(item.stripe_cardholder_id)) ||
      !Array.isArray(item.endorsements)) throw new Error("Invalid Bridge customer");
  const endorsements = item.endorsements.map(object);
  const cards = endorsements.filter((e) => e.name === "cards");
  if (cards.length > 1 || endorsements.some((e) => typeof e.name !== "string")) throw new Error("Invalid Bridge endorsements");
  let cardsEndorsement: BridgeCustomer["cardsEndorsement"] = null;
  if (cards.length) {
    const endorsement = cards[0];
    const requirements = object(endorsement.requirements);
    if (!["approved", "pending", "incomplete", "rejected", "revoked"].includes(String(endorsement.status)) ||
        !Array.isArray(requirements.pending) || !requirements.pending.every((v) => typeof v === "string") ||
        !(requirements.missing === null || Array.isArray(requirements.missing) && requirements.missing.every((v) => typeof v === "string")) ||
        !Array.isArray(requirements.issues)) throw new Error("Invalid Bridge cards endorsement");
    cardsEndorsement = { status: endorsement.status as NonNullable<BridgeCustomer["cardsEndorsement"]>["status"],
      pending: requirements.pending.length > 0, missing: Array.isArray(requirements.missing) && requirements.missing.length > 0,
      issues: requirements.issues.length > 0 };
  }
  return { id: item.id, status: item.status as BridgeCustomer["status"],
    stripeCardholderId: typeof item.stripe_cardholder_id === "string" ? item.stripe_cardholder_id : null, cardsEndorsement };
}

export function createBridgeClient(config: CardJourneyConfig, fetcher: typeof fetch = fetch) {
  async function request(path: string): Promise<unknown> {
    const response = await fetcher(`${config.bridgeOrigin}${path}`, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
      headers: { "Api-Key": config.bridgeApiKey },
    });
    if (!response.ok) throw new Error(`Bridge request failed (${response.status})`);
    try { return await response.json(); } catch { throw new Error("Invalid Bridge JSON"); }
  }
  return {
    async readCustomer(id: string): Promise<BridgeCustomer> {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid Bridge customer ID");
      const customer = parseBridgeCustomer(await request(`/v0/customers/${encodeURIComponent(id)}`));
      if (customer.id !== id) throw new Error("Bridge customer ID mismatch");
      return customer;
    },
  };
}
