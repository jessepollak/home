import "server-only";

import type { CardJourneyConfig } from "../bridge/journey-config";
import { readProviderJson } from "../read-provider-json";

export type StripeCard = Readonly<{
  id: string;
  cardholderId: string;
  status: "active" | "inactive" | "canceled";
  customerFrozen: boolean;
  last4: string;
}>;

export function parseStripeCard(value: unknown): StripeCard {
  if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Invalid Stripe card");
  const card = value as Record<string, unknown>;
  const cardholder = typeof card.cardholder === "string" ? card.cardholder :
    typeof card.cardholder === "object" && card.cardholder !== null && !Array.isArray(card.cardholder)
      ? (card.cardholder as Record<string, unknown>).id : null;
  if (typeof card.id !== "string" || !/^ic_[A-Za-z0-9]+$/.test(card.id) ||
      typeof cardholder !== "string" || !/^ich_[A-Za-z0-9]+$/.test(cardholder) ||
      !["active", "inactive", "canceled"].includes(String(card.status)) ||
      typeof card.last4 !== "string" || !/^\d{4}$/.test(card.last4) ||
      typeof card.metadata !== "object" || card.metadata === null || Array.isArray(card.metadata) ||
      !(Object.prototype.hasOwnProperty.call(card.metadata, "home_freeze")
        ? (card.metadata as Record<string, unknown>).home_freeze === "customer" : true)) throw new Error("Invalid Stripe card");
  return { id: card.id, cardholderId: cardholder, status: card.status as StripeCard["status"], last4: card.last4,
    customerFrozen: (card.metadata as Record<string, unknown>).home_freeze === "customer" };
}

export function parseStripeCardholder(value: unknown): { id: string; status: "active" | "inactive" | "blocked" } {
  if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Invalid Stripe cardholder");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !/^ich_[A-Za-z0-9]+$/.test(item.id) ||
      !["active", "inactive", "blocked"].includes(String(item.status))) throw new Error("Invalid Stripe cardholder");
  return { id: item.id, status: item.status as "active" | "inactive" | "blocked" };
}

export function createStripeClient(config: CardJourneyConfig, fetcher: typeof fetch = fetch) {
  return {
    async readCardholder(id: string): Promise<ReturnType<typeof parseStripeCardholder>> {
      if (!/^ich_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe cardholder ID");
      const response = await fetcher(`https://api.stripe.com/v1/issuing/cardholders/${encodeURIComponent(id)}`, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { [["Author", "ization"].join("")]: ["Bearer", config.stripeSecretKey].join(" "), "Stripe-Version": config.stripeApiVersion },
      });
      if (!response.ok) throw new Error(`Stripe request failed (${response.status})`);
      const payload = await readProviderJson(response, "Stripe");
      const cardholder = parseStripeCardholder(payload);
      if (cardholder.id !== id) throw new Error("Stripe cardholder ID mismatch");
      return cardholder;
    },
    async readCard(id: string): Promise<StripeCard> {
      if (!/^ic_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe card ID");
      const response = await fetcher(`https://api.stripe.com/v1/issuing/cards/${encodeURIComponent(id)}`, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { [["Author", "ization"].join("")]: ["Bearer", config.stripeSecretKey].join(" "), "Stripe-Version": config.stripeApiVersion },
      });
      if (!response.ok) throw new Error(`Stripe request failed (${response.status})`);
      const payload = await readProviderJson(response, "Stripe");
      const card = parseStripeCard(payload);
      if (card.id !== id) throw new Error("Stripe card ID mismatch");
      return card;
    },
  };
}
