import "server-only";

import { createHash } from "node:crypto";
import { isAddress } from "viem";
import type { SqlExecutor } from "@/server/db/sql";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { CardWriteErrorCode, RevealRequest, RevealGrant } from "@/shared/cards/contract";
import { createCardAccountStore, type CardAccountLink } from "./account-store";
import type { ProgramLink } from "./program";
import type { CardMode, CardProviderName } from "./provider";
import { readCardState } from "./journey";
import { readCardPrograms } from "./programs";

export class CardWriteFailure extends Error {
  constructor(readonly code: CardWriteErrorCode, readonly status: number) { super(code); }
}
function key(provider: CardProviderName, purpose: string, ...parts: string[]): string {
  const hash = createHash("sha256").update(JSON.stringify([provider, purpose, ...parts])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function createCardWriteService({ sql, programs = readCardPrograms(sql), mode = programs.mode }: {
  sql: SqlExecutor; programs?: ReturnType<typeof readCardPrograms>; mode?: CardMode | null;
}) {
  function availableMode() { if (!mode) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503); return mode; }
  async function selected(link: CardAccountLink | null, customerId: string, selectedMode: CardMode) {
    const program = link ? programs.byProvider(link.provider, selectedMode) : await programs.programFor(customerId, selectedMode);
    if (!program) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
    return program;
  }
  async function owned(tx: SqlExecutor, customerId: string, id: string) {
    const selectedMode = availableMode();
    const store = createCardAccountStore(tx);
    const link = await store.read(customerId, selectedMode, undefined, true);
    const card = link?.cards.find((card) => card.id === id);
    if (!link?.accountId || !card) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
    const program = await selected(link, customerId, selectedMode);
    const state = await readCardState(customerId, selectedMode, { store, programFor: async () => program });
    if (state.state === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
    const fresh = state.cards.find((item) => item.id === id);
    if (!fresh) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
    return { link, card, program, state, fresh };
  }
  return {
    async enroll(customerId: string, redirectUri: string) {
      const selectedMode = availableMode();
      const enrollment = await sql.transaction(async (tx) => {
        const store = createCardAccountStore(tx);
        const initial = await store.read(customerId, selectedMode);
        const first = await selected(initial, customerId, selectedMode);
        await tx.query("INSERT INTO card_accounts(customer_id,mode,provider) VALUES ($1,$2,$3) ON CONFLICT (customer_id,mode) DO NOTHING", [customerId, selectedMode, first.provider]);
        const link = await store.read(customerId, selectedMode, undefined, true);
        if (!link) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const program = await selected(link, customerId, selectedMode);
        const result = await program.enroll(link, { customerId, idempotencyKey: key(program.provider, "enroll", selectedMode, customerId) });
        await store.update(link, result.link);
        return { program, link: { ...link, ...result.link } };
      });
      const next = await enrollment.program.enrollmentNext(enrollment.link, { redirectUri });
      if (next.kind === "redirect") {
        const url = new URL(next.url);
        if (url.protocol !== "https:" || !enrollment.program.enrollmentHosts.includes(url.host) || url.username || url.password || url.hash)
          throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
      }
      return next;
    },
    async issue(customerId: string, session: VerifiedAccountSession): Promise<Readonly<{ id: string; status: "active" | "frozen" }>> {
      const selectedMode = availableMode();
      if (!session.smartAccount) throw new CardWriteFailure("CARD_NOT_READY", 409);
      const wallet = session.smartAccount.address.toLowerCase();
      if (!isAddress(wallet)) throw new CardWriteFailure("CARD_NOT_READY", 409);
      return sql.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cards:${selectedMode}:${wallet}`]);
        const store = createCardAccountStore(tx);
        const link = await store.read(customerId, selectedMode, undefined, true);
        if (!link?.accountId) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const program = await selected(link, customerId, selectedMode);
        if (!(await tx.query("SELECT 1 FROM customer_wallets WHERE customer_id=$1 AND chain_id=8453 AND address=$2", [customerId, wallet])).rowCount)
          throw new CardWriteFailure("CARD_NOT_READY", 409);
        const state = await readCardState(customerId, selectedMode, { store, programFor: async () => program });
        if (state.state === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        const others = await tx.query<{ customer_id: string; provider: CardProviderName; provider_card_id: string; provider_account_id: string | null; provider_cardholder_id: string | null }>(
          `SELECT c.customer_id,c.provider,c.provider_card_id,a.provider_account_id,a.provider_cardholder_id FROM cards c
           JOIN card_accounts a ON a.customer_id=c.customer_id AND a.mode=c.mode AND a.provider=c.provider
           WHERE c.mode=$1 AND c.wallet_address=$2 AND c.customer_id<>$3`, [selectedMode, wallet, customerId]);
        for (const row of others.rows) {
          const other = programs.byProvider(row.provider, selectedMode);
          if (!other) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
          const otherLink: ProgramLink = { customerId: row.customer_id, mode: selectedMode, accountId: row.provider_account_id, cardholderId: row.provider_cardholder_id };
          let reads;
          try { reads = await other.readCards(otherLink, [row.provider_card_id]); } catch { throw new CardWriteFailure("CARDS_UNAVAILABLE", 503); }
          const read = reads[0];
          if (reads.length !== 1 || !read?.ok || read.providerCardId !== row.provider_card_id || read.card.providerCardId !== row.provider_card_id)
            throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
          if (read.card.status !== "canceled") throw new CardWriteFailure("CARD_CONFLICT", 409);
        }
        const sameWallet = link.cards.filter((card) => card.walletAddress === wallet);
        const existing = state.cards.find((item) => item.status !== "canceled" && sameWallet.some((card) => card.id === item.id));
        if (existing) {
          if (existing.status !== "active" && existing.status !== "frozen") throw new CardWriteFailure("CARD_NOT_READY", 409);
          return { id: existing.id, status: existing.status };
        }
        if (!["ready-to-issue", "active", "frozen", "canceled"].includes(state.state)) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const account = await program.readAccount(link);
        if (account.status === "unavailable") throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        if (account.status !== "ready") throw new CardWriteFailure("CARD_NOT_READY", 409);
        await store.update(link, account.link);
        const currentLink = { ...link, ...account.link };
        const card = await program.issue(currentLink, wallet, key(program.provider, "issue", selectedMode, customerId, wallet, String(sameWallet.length)));
        if (card.status !== "active" || card.cardholderId !== (account.cardholderId ?? currentLink.cardholderId)) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        await tx.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5) ON CONFLICT (provider,mode,provider_card_id) DO NOTHING", [customerId, selectedMode, program.provider, card.providerCardId, wallet]);
        const linked = await tx.query<{ id: string }>("SELECT id FROM cards WHERE customer_id=$1 AND mode=$2 AND provider=$3 AND provider_card_id=$4 AND wallet_address=$5", [customerId, selectedMode, program.provider, card.providerCardId, wallet]);
        if (!linked.rows[0]) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        return { id: linked.rows[0].id, status: "active" };
      });
    },
    async freeze(customerId: string, id: string, frozen: boolean): Promise<string> {
      return sql.transaction(async (tx) => {
        const { link, card, program, state, fresh } = await owned(tx, customerId, id);
        if (!frozen && state.state === "restricted" || fresh.status === "restricted" || fresh.status === "canceled") throw new CardWriteFailure("CARD_NOT_READY", 409);
        if (fresh.status === (frozen ? "frozen" : "active")) return id;
        const result = await program.setFrozen(link, card.providerCardId, frozen, crypto.randomUUID());
        if (result.providerCardId !== card.providerCardId || link.cardholderId !== null && result.cardholderId !== link.cardholderId || result.status !== (frozen ? "frozen" : "active"))
          throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        return id;
      });
    },
    async reveal(customerId: string, id: string, request: RevealRequest): Promise<RevealGrant> {
      return sql.transaction(async (tx) => {
        const { link, card, program, state, fresh } = await owned(tx, customerId, id);
        if (!["active", "frozen"].includes(state.state) || !["active", "frozen"].includes(fresh.status)) throw new CardWriteFailure("CARD_NOT_READY", 409);
        const grant = await program.reveal(link, card.providerCardId, request);
        if (grant.method !== request.method || grant.step !== request.step || grant.issuingCard !== card.providerCardId ||
            request.step === "grant" && (grant.step !== "grant" || grant.nonce !== request.nonce)) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
        return grant;
      });
    },
  };
}
