import "server-only";

import { BASE_USDC } from "@/shared/assets/base";
import { serverEnvironment } from "@/server/config/env";
import { readCardAllowanceRegistry } from "../allowance/config";
import type { CardProgram, ProgramAccount, ProgramCard, ProgramLink } from "../program";
import { createBridgeClient, type BridgeCustomer } from "./client";
import { readCardJourneyConfig, type CardJourneyConfig } from "./journey-config";
import { createStripeClient, type StripeCard } from "../stripe/client";
import { createStripeTransactionClient } from "../stripe/transactions";
import { createBridgeWebhookProvider, createStripeWebhookProvider } from "./webhook";

export function bridgeAccountStatus(customer: BridgeCustomer, stored: string | null, holder: "active" | "inactive" | "blocked" | null): ProgramAccount["status"] {
  if (stored && customer.stripeCardholderId !== stored) return "unavailable";
  if (customer.status === "paused" || customer.status === "deposits_restricted" || holder && holder !== "active") return "restricted";
  if (customer.status === "rejected" || customer.status === "offboarded") return "ineligible";
  const endorsement = customer.cardsEndorsement;
  if (customer.status === "under_review" || endorsement?.pending || endorsement?.status === "approved" && !customer.stripeCardholderId) return "verification-pending";
  if (customer.status !== "active" || endorsement?.status !== "approved" || endorsement.missing || endorsement.issues) return "verification-required";
  return "ready";
}
function mapped(card: StripeCard): ProgramCard {
  return { providerCardId: card.id, cardholderId: card.cardholderId, last4: card.last4,
    status: card.status === "inactive" ? card.customerFrozen ? "frozen" : "restricted" : card.status };
}

export function createBridgeProgram(config: CardJourneyConfig, funding: CardProgram["funding"], events: CardProgram["events"] = [], fetcher: typeof fetch = fetch): CardProgram {
  const bridge = createBridgeClient(config, fetcher);
  const stripe = createStripeClient(config, fetcher);
  const purchases = (signal?: AbortSignal) => createStripeTransactionClient(config, fetcher, signal);
  return {
    provider: "bridge", mode: config.mode, funding, events, enrollmentHosts: ["bridge.withpersona.com"],
    async readAccount(link, signal) {
      if (!link.accountId) throw new Error("Missing Bridge account");
      const customer = await bridge.readCustomer(link.accountId, signal);
      if (link.cardholderId && customer.stripeCardholderId !== link.cardholderId)
        return { status: "unavailable", cardholderId: customer.stripeCardholderId, link: {} };
      const holder = customer.stripeCardholderId ? await stripe.readCardholder(customer.stripeCardholderId, signal) : null;
      return { status: bridgeAccountStatus(customer, link.cardholderId, holder?.status ?? null),
        cardholderId: customer.stripeCardholderId, link: customer.stripeCardholderId ? { cardholderId: customer.stripeCardholderId } : {} };
    },
    async readCards(_link, ids, signal) {
      return Promise.all(ids.map(async (providerCardId) => {
        try { return { providerCardId, ok: true as const, card: mapped(await stripe.readCard(providerCardId, signal)) }; }
        catch { return { providerCardId, ok: false as const }; }
      }));
    },
    async enroll(link, request) {
      const customer = link.accountId ? await bridge.readCustomer(link.accountId) : await bridge.createCustomer(request.idempotencyKey);
      if (link.cardholderId && customer.stripeCardholderId !== link.cardholderId) throw new Error("Bridge cardholder mismatch");
      return { link: { accountId: customer.id, ...(customer.stripeCardholderId ? { cardholderId: customer.stripeCardholderId } : {}) },
        next: { kind: "redirect", url: await bridge.cardsKycLink(customer.id, request.redirectUri) } };
    },
    async issue(link: ProgramLink, wallet, key) {
      const account = await this.readAccount(link);
      if (account.status !== "ready" || !account.cardholderId) throw new Error("Bridge account not ready");
      return mapped(await stripe.issueCard(account.cardholderId, wallet, key));
    },
    async setFrozen(_link, id, frozen, key) { return mapped(await stripe.setCardFreeze(id, frozen, key)); },
    async reveal(_link, issuingCard, request) {
      if (request.step === "prepare") return { method: request.method, step: request.step, issuingCard };
      return { method: request.method, step: request.step, issuingCard, nonce: request.nonce,
        ephemeralKeySecret: await stripe.ephemeralKey(issuingCard, request.nonce) };
    },
    purchases: {
      read: (ref, signal) => purchases(signal).read(ref.kind, ref.id),
      async list(id, since, signal) {
        const lists = await Promise.all([purchases(signal).list("authorization", id, Math.floor(since.getTime() / 1000)),
          purchases(signal).list("transaction", id, Math.floor(since.getTime() / 1000))]);
        return { rows: lists.flatMap((list) => list.rows), partial: lists.some((list) => list.partial) };
      },
      refFor(event) {
        if (event.provider !== "bridge" || !event.externalIds.card || !event.externalIds.transaction) return null;
        if (event.kind.startsWith("issuing_authorization.")) return { id: event.externalIds.transaction, kind: "authorization" };
        if (event.kind.startsWith("issuing_transaction.")) return { id: event.externalIds.transaction, kind: "transaction" };
        return null;
      },
    },
  };
}

export function readBridgeProgram(env = serverEnvironment()): CardProgram | null {
  const config = readCardJourneyConfig(env);
  if (!config) return null;
  if (config.funding.kind === "financial_account") return createBridgeProgram(config, { strategy: "deposit" });
  const registry = readCardAllowanceRegistry(env);
  if (!registry || registry.bridge.mode !== config.mode) throw new Error("Bridge card funding unavailable");
  return createBridgeProgram(config, { strategy: "allowance-pull", chainId: 8453, token: BASE_USDC, spender: registry.current,
    retired: registry.retired, maximumBaseUnits: registry.maximumBaseUnits, prerequisitesMet: true },
    [createBridgeWebhookProvider(registry.bridge), createStripeWebhookProvider(registry.bridge)]);
}
