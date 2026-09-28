import "server-only";

import { createHash } from "node:crypto";
import type { SqlExecutor } from "@/server/db/sql";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { CardWriteErrorCode } from "@/shared/cards/contract";
import { createCardAccountStore } from "./account-store";
import type { CardJourneyConfig } from "./bridge/journey-config";
import type { createBridgeClient } from "./bridge/client";
import { readCardState } from "./journey";
import type { createStripeClient } from "./stripe/client";

type Bridge = ReturnType<typeof createBridgeClient>;
type Stripe = ReturnType<typeof createStripeClient>;
type Dependencies = { sql: SqlExecutor; config: CardJourneyConfig; bridge: Bridge; stripe: Stripe };

export class CardWriteFailure extends Error {
  constructor(readonly code: CardWriteErrorCode, readonly status: number) { super(code); }
}

function key(...parts: string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function lockedAccount(tx: SqlExecutor, customerId: string, mode: string) {
  return (await tx.query<{ bridge_customer_id: string | null; stripe_cardholder_id: string | null }>(
    "SELECT bridge_customer_id,stripe_cardholder_id FROM card_accounts WHERE customer_id=$1 AND mode=$2 FOR UPDATE",
    [customerId, mode],
  )).rows[0] ?? null;
}

export function createCardWriteService({ sql, config, bridge, stripe }: Dependencies) {
  const mode = config.mode;
  return {
    async enroll(customerId: string): Promise<string> {
      await sql.query("INSERT INTO card_accounts(customer_id,mode) VALUES ($1,$2) ON CONFLICT (customer_id,mode) DO NOTHING", [customerId, mode]);
      const bridgeId = await sql.transaction(async (tx) => {
        const account = await lockedAccount(tx, customerId, mode);
        if (!account) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        if (account.bridge_customer_id) return account.bridge_customer_id;
        const customer = await bridge.createCustomer(key("bridge-customer", mode, customerId));
        await tx.query("UPDATE card_accounts SET bridge_customer_id=$3,updated_at=now() WHERE customer_id=$1 AND mode=$2", [customerId, mode, customer.id]);
        return customer.id;
      });
      const customer = await bridge.readCustomer(bridgeId);
      if (customer.stripeCardholderId) {
        const updated = await sql.query(
          "UPDATE card_accounts SET stripe_cardholder_id=$3,updated_at=now() WHERE customer_id=$1 AND mode=$2 AND (stripe_cardholder_id IS NULL OR stripe_cardholder_id=$3)",
          [customerId, mode, customer.stripeCardholderId],
        );
        if (!updated.rowCount) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
      }
      return bridge.cardsKycLink(bridgeId);
    },
    async issue(customerId: string, session: VerifiedAccountSession): Promise<string> {
      if (!session.smartAccount) throw new CardWriteFailure("CARD_NOT_READY", 409);
      const wallet = session.smartAccount.address.toLowerCase();
      return sql.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cards:${mode}:${wallet}`]);
        const account = await lockedAccount(tx, customerId, mode);
        if (!account?.bridge_customer_id) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const ownerWallet = await tx.query("SELECT 1 FROM customer_wallets WHERE customer_id=$1 AND chain_id=8453 AND address=$2", [customerId, wallet]);
        if (!ownerWallet.rowCount) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const state = await readCardState(customerId, mode, { store: createCardAccountStore(tx), bridge, stripe });
        if (state.state === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const current = await createCardAccountStore(tx).read(customerId, mode);
        if (!current) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const sameWallet = current.cards.filter((card) => card.walletAddress === wallet);
        const otherCards = await tx.query<{ stripe_card_id: string }>(
          "SELECT stripe_card_id FROM cards WHERE mode=$1 AND wallet_address=$2 AND customer_id<>$3", [mode, wallet, customerId],
        );
        for (const otherCard of otherCards.rows) {
          if ((await stripe.readCard(otherCard.stripe_card_id)).status !== "canceled") throw new CardWriteFailure("CARD_CONFLICT", 409);
        }
        const existing = sameWallet.find((card) => state.cards.some((item) => item.id === card.stripeCardId && item.status !== "canceled"));
        if (existing) return existing.stripeCardId;
        if (!["ready-to-issue", "active", "frozen", "canceled"].includes(state.state)) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const customer = await bridge.readCustomer(account.bridge_customer_id);
        if (!customer.stripeCardholderId || customer.cardsEndorsement?.status !== "approved" || customer.cardsEndorsement.missing || customer.cardsEndorsement.pending || customer.cardsEndorsement.issues || customer.status !== "active")
          throw new CardWriteFailure("CARD_NOT_READY", 409);
        if (account.stripe_cardholder_id && account.stripe_cardholder_id !== customer.stripeCardholderId) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const holder = await stripe.readCardholder(customer.stripeCardholderId);
        if (holder.status !== "active") throw new CardWriteFailure("CARD_NOT_READY", 409);
        const card = await stripe.issueCard(customer.stripeCardholderId, wallet, key("stripe-issue", mode, customerId, wallet, String(sameWallet.length)));
        if (card.status !== "active" || card.customerFrozen) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        await tx.query("UPDATE card_accounts SET stripe_cardholder_id=$3,updated_at=now() WHERE customer_id=$1 AND mode=$2", [customerId, mode, customer.stripeCardholderId]);
        await tx.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES (gen_random_uuid(),$1,$2,$3,$4) ON CONFLICT (stripe_card_id) DO NOTHING", [customerId, mode, card.id, wallet]);
        const linked = await tx.query("SELECT 1 FROM cards WHERE customer_id=$1 AND mode=$2 AND stripe_card_id=$3 AND wallet_address=$4", [customerId, mode, card.id, wallet]);
        if (!linked.rowCount) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        return card.id;
      });
    },
    async freeze(customerId: string, id: string, freeze: boolean): Promise<string> {
      return sql.transaction(async (tx) => {
        const account = await lockedAccount(tx, customerId, mode);
        if (!account?.bridge_customer_id) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
        const owned = await tx.query("SELECT 1 FROM cards WHERE customer_id=$1 AND mode=$2 AND stripe_card_id=$3", [customerId, mode, id]);
        if (!owned.rowCount) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
        const state = await readCardState(customerId, mode, { store: createCardAccountStore(tx), bridge, stripe });
        if (state.state === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const found = state.cards.find((card) => card.id === id);
        if (!found) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        if (state.state === "restricted" || found.status === "restricted" || found.status === "canceled") throw new CardWriteFailure("CARD_NOT_READY", 409);
        if (found.status === (freeze ? "frozen" : "active")) return id;
        if (found.status !== (freeze ? "active" : "frozen")) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const card = await stripe.setCardFreeze(id, freeze, crypto.randomUUID());
        if (card.cardholderId !== account.stripe_cardholder_id && account.stripe_cardholder_id !== null) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        return card.id;
      });
    },
    async ephemeralKey(customerId: string, id: string, nonce: string): Promise<string> {
      return sql.transaction(async (tx) => {
        const account = await lockedAccount(tx, customerId, mode);
        if (!account?.bridge_customer_id) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
        const owned = await tx.query("SELECT 1 FROM cards WHERE customer_id=$1 AND mode=$2 AND stripe_card_id=$3", [customerId, mode, id]);
        if (!owned.rowCount) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
        const state = await readCardState(customerId, mode, { store: createCardAccountStore(tx), bridge, stripe });
        if (state.state === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const card = state.cards.find((item) => item.id === id);
        if (!card || !["active", "frozen"].includes(state.state) || !["active", "frozen"].includes(card.status))
          throw new CardWriteFailure("CARD_NOT_READY", 409);
        return stripe.ephemeralKey(id, nonce);
      });
    },
  };
}
