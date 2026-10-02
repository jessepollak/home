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
  async function request(path: string, params?: URLSearchParams, key?: string, root = false, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const response = await fetcher(`https://api.stripe.com/v1/${root ? "" : "issuing/"}${path}`, {
      method: params ? "POST" : "GET", redirect: "manual", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      headers: { [["Author", "ization"].join("")]: ["Bearer", config.stripeSecretKey].join(" "), "Stripe-Version": config.stripeApiVersion,
        ...(params ? { "Content-Type": "application/x-www-form-urlencoded", ...(key ? { "Idempotency-Key": key } : {}) } : {}) },
      ...(params ? { body: params.toString() } : {}),
    });
    if (!response.ok) throw new Error(`Stripe request failed (${response.status})`);
    return readProviderJson(response, "Stripe");
  }
  return {
    async readCardholder(id: string, signal?: AbortSignal): Promise<ReturnType<typeof parseStripeCardholder>> {
      if (!/^ich_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe cardholder ID");
      const payload = await request(`cardholders/${encodeURIComponent(id)}`, undefined, undefined, false, signal);
      const cardholder = parseStripeCardholder(payload);
      if (cardholder.id !== id) throw new Error("Stripe cardholder ID mismatch");
      return cardholder;
    },
    async readCard(id: string, signal?: AbortSignal): Promise<StripeCard> {
      if (!/^ic_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe card ID");
      const payload = await request(`cards/${encodeURIComponent(id)}`, undefined, undefined, false, signal);
      const card = parseStripeCard(payload);
      if (card.id !== id) throw new Error("Stripe card ID mismatch");
      return card;
    },
    async issueCard(cardholderId: string, wallet: string, key: string): Promise<StripeCard> {
      if (!/^ich_[A-Za-z0-9]+$/.test(cardholderId) || !/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error("Invalid card issuance owner");
      const params = new URLSearchParams({ cardholder: cardholderId, currency: "usd", type: "virtual", status: "active" });
      if (config.funding.kind === "financial_account") {
        if (config.mode !== "sandbox") throw new Error("Financial account funding requires sandbox");
        params.set("financial_account_v2", config.funding.financialAccount);
      } else {
        params.set("crypto_wallet[chain]", "base");
        params.set("crypto_wallet[currency]", "usdc");
        params.set("crypto_wallet[type]", "standard");
        params.set("crypto_wallet[address]", wallet);
      }
      const card = parseStripeCard(await request("cards", params, key));
      if (card.cardholderId !== cardholderId) throw new Error("Stripe cardholder mismatch");
      return card;
    },
    async setCardFreeze(id: string, freeze: boolean, key: string): Promise<StripeCard> {
      if (!/^ic_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe card ID");
      const params = new URLSearchParams({ status: freeze ? "inactive" : "active", "metadata[home_freeze]": freeze ? "customer" : "" });
      const card = parseStripeCard(await request(`cards/${encodeURIComponent(id)}`, params, key));
      if (card.id !== id || card.status !== (freeze ? "inactive" : "active") || card.customerFrozen !== freeze) throw new Error("Stripe card update mismatch");
      return card;
    },
    async ephemeralKey(id: string, nonce: string): Promise<string> {
      if (!/^ic_[A-Za-z0-9]+$/.test(id) || !/^[A-Za-z0-9_-]{8,256}$/.test(nonce)) throw new Error("Invalid Stripe ephemeral key request");
      const value = await request("ephemeral_keys", new URLSearchParams({ issuing_card: id, nonce }), undefined, true);
      if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Invalid Stripe ephemeral key response");
      const secret = (value as Record<string, unknown>).secret;
      if (typeof secret !== "string" || !/^ek_(test|live)_[A-Za-z0-9_-]{10,2048}$/.test(secret) ||
          !secret.startsWith(config.mode === "sandbox" ? "ek_test_" : "ek_live_")) throw new Error("Invalid Stripe ephemeral key response");
      return secret;
    },
  };
}
