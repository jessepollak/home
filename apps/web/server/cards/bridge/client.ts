import "server-only";

import type { CardJourneyConfig } from "./journey-config";
import { readProviderJson } from "../read-provider-json";

export type BridgeCustomer = Readonly<{
  id: string;
  status: "not_started" | "incomplete" | "awaiting_questionnaire" | "awaiting_ubo" | "under_review" | "active" | "rejected" | "paused" | "offboarded" | "deposits_restricted";
  stripeCardholderId: string | null;
  cardsEndorsement: Readonly<{
    status: "approved" | "incomplete" | "revoked";
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
      typeof item.status !== "string" || !["not_started", "incomplete", "awaiting_questionnaire", "awaiting_ubo", "under_review", "active", "rejected", "paused", "offboarded", "deposits_restricted"].includes(item.status) ||
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
    if (typeof endorsement.status !== "string" || !["approved", "incomplete", "revoked"].includes(endorsement.status) ||
        !Array.isArray(requirements.pending) || !requirements.pending.every((v) => typeof v === "string") ||
        !(requirements.missing === null || typeof requirements.missing === "object" && !Array.isArray(requirements.missing)) ||
        !Array.isArray(requirements.issues) || !requirements.issues.every((v) => typeof v === "string" || typeof v === "object" && v !== null && !Array.isArray(v)))
      throw new Error("Invalid Bridge cards endorsement");
    cardsEndorsement = { status: endorsement.status as NonNullable<BridgeCustomer["cardsEndorsement"]>["status"],
      pending: requirements.pending.length > 0, missing: requirements.missing !== null,
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
    return readProviderJson(response, "Bridge");
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
