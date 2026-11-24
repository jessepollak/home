import "server-only";

import { NON_DECLINED_ACTION_SQL, type ActionOutcome } from "@/server/actions/store";
import { deriveActionStatus, type ActionReceiptState } from "@/server/actions/status";
import type { SqlExecutor } from "@/server/db/sql";
import { parseAddress, parseHash32, type Address } from "@/shared/chain/hex";
import {
  ADMIN_CUSTOMERS_CONTRACT_VERSION,
  CUSTOMER_DETAIL_PAGE_SIZE,
  type CustomerAction,
  type CustomerDetailResponse,
  type CustomerEmail,
  type CustomerFundingOrder,
  type CustomerSearchQuery,
  type CustomerSearchRow,
  type CustomerSearchTerm,
  type CustomerSection,
  type CustomerWalletBalance,
} from "@/shared/admin-customers/contract";

const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";
const WALLETS_PER_ROW = 3;
const BALANCE_WALLET_LIMIT = 10;

type Status = CustomerSearchRow["status"];
type FirstSeenSource = CustomerSearchRow["firstSeenSource"];
type SignIn = CustomerSearchRow["signIn"][number];
type CustomerRow = { id: string; status: Status; merged: boolean; country: string | null; first_seen_at: Date; first_seen_source: FirstSeenSource; last_seen_at: Date };
type CredentialRow = { customer_id: string; account_provider: SignIn; email: string | null; email_source: CustomerEmail["source"] | null };
export type CustomerProfile = CustomerDetailResponse["profile"];
export type BalanceReader = (wallets: readonly Address[], signal?: AbortSignal) => Promise<CustomerWalletBalance[]>;

function iso(value: Date): string { return new Date(value).toISOString(); }

function observedReceiptState(row: { transactionHash: string | null; receiptTransactionHash: string | null; receiptBlockHash: string | null; receiptBlockNumber: string | null; receiptOutcome: string | null }): ActionReceiptState | null {
  if (!row.transactionHash || !row.receiptTransactionHash || row.receiptTransactionHash.toLowerCase() !== row.transactionHash.toLowerCase() ||
    !row.receiptBlockHash || row.receiptBlockNumber === null) return null;
  if (row.receiptOutcome === "succeeded") return "confirmed";
  if (row.receiptOutcome === "reverted") return "failed";
  return null;
}

function candidates(term: Exclude<CustomerSearchTerm, { kind: "all" }>): { sql: string; values: unknown[] } {
  switch (term.kind) {
    case "id":
      return { sql: `SELECT id AS customer_id FROM customers WHERE id=$1::uuid
        UNION SELECT customer_id FROM funding_orders WHERE id=$1::uuid AND customer_id IS NOT NULL
        UNION SELECT customer_id FROM funding_orders WHERE provider_order_id IN ($2::text, $1::text) AND customer_id IS NOT NULL`, values: [term.value, term.orderId] };
    case "transaction-hash":
      return { sql: `SELECT customer_id FROM actions WHERE lower(transaction_hash)=$1 AND customer_id IS NOT NULL
        UNION SELECT customer_id FROM funding_orders WHERE transaction_hash=$1 AND customer_id IS NOT NULL`, values: [term.value] };
    case "address":
      return { sql: "SELECT customer_id FROM customer_wallets WHERE address=$1", values: [term.value] };
    case "address-prefix":
      return { sql: "SELECT customer_id FROM customer_wallets WHERE address LIKE $1", values: [`${term.value}%`] };
    case "email-or-order":
      return { sql: `SELECT customer_id FROM customer_credentials WHERE $1::text IS NOT NULL AND email LIKE $1 ESCAPE '\\'
        UNION SELECT customer_id FROM funding_orders WHERE $2::text IS NOT NULL AND provider_order_id=$2 AND customer_id IS NOT NULL`,
      values: [term.emailPrefix === null ? null : `${term.emailPrefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`, term.orderId] };
  }
}

function section<T>(read: Promise<T>): Promise<CustomerSection<T>> {
  return read.then((value) => ({ status: "available" as const, value }), () => ({ status: "unavailable" as const }));
}

export class AdminCustomerStore {
  constructor(private readonly sql: SqlExecutor) {}

  private bounded<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      return run(tx);
    });
  }

  search(query: CustomerSearchQuery): Promise<{ customers: CustomerSearchRow[]; nextCursor: string | null }> {
    return this.bounded(async (tx) => {
      const matched = query.term.kind === "all" ? null : candidates(query.term);
      const offset = matched?.values.length ?? 0;
      const parameter = (index: number) => `$${offset + index}`;
      const rows = (await tx.query<CustomerRow>(`${matched ? `WITH matched AS MATERIALIZED (${matched.sql}) ` : ""}
        SELECT c.id, c.status, c.merged_into IS NOT NULL AS merged, c.country, c.first_seen_at, c.first_seen_source, c.last_seen_at
        FROM customers c
        WHERE ${matched ? "c.id IN (SELECT customer_id FROM matched)" : "true"}
          AND (${parameter(1)}::text='any' OR c.status=${parameter(1)}::text)
          AND (${parameter(2)}::text='any' OR EXISTS (SELECT 1 FROM customer_credentials f WHERE f.customer_id=c.id AND f.account_provider=${parameter(2)}::text))
          AND (${parameter(3)}::text='any' OR (${parameter(3)}::text='funded') = EXISTS (SELECT 1 FROM funding_orders o WHERE o.customer_id=c.id AND o.state='received' AND NOT o.sandbox))
          AND (${parameter(4)}::uuid IS NULL OR (c.first_seen_at, c.id) < (SELECT p.first_seen_at, p.id FROM customers p WHERE p.id=${parameter(4)}::uuid))
        ORDER BY c.first_seen_at DESC, c.id DESC
        LIMIT ${parameter(5)}`,
      [...(matched?.values ?? []), query.filters.status, query.filters.signIn, query.filters.funded, query.after, query.limit + 1])).rows;
      const page = rows.slice(0, query.limit);
      const ids = page.map((row) => row.id);
      if (!ids.length) return { customers: [], nextCursor: null };
      const credentials = await tx.query<CredentialRow>("SELECT customer_id, account_provider, email, email_source FROM customer_credentials WHERE customer_id = ANY($1::uuid[]) ORDER BY first_seen_at, id", [ids]);
      const wallets = await tx.query<{ customer_id: string; address: string }>("SELECT customer_id, address FROM customer_wallets WHERE customer_id = ANY($1::uuid[]) ORDER BY created_at, id", [ids]);
      const funded = await tx.query<{ customer_id: string }>("SELECT DISTINCT customer_id FROM funding_orders WHERE customer_id = ANY($1::uuid[]) AND state='received' AND NOT sandbox", [ids]);
      const fundedIds = new Set(funded.rows.map((row) => row.customer_id));
      const customers = page.map((row): CustomerSearchRow => {
        const own = credentials.rows.filter((credential) => credential.customer_id === row.id);
        const addresses = wallets.rows.flatMap((wallet) => {
          const parsed = wallet.customer_id === row.id ? parseAddress(wallet.address) : null;
          return parsed ? [parsed] : [];
        });
        return {
          customerId: row.id, status: row.status, merged: row.merged, country: row.country,
          firstSeenAt: iso(row.first_seen_at), firstSeenSource: row.first_seen_source, lastSeenAt: iso(row.last_seen_at),
          signIn: [...new Set(own.map((credential) => credential.account_provider))],
          emails: emails(own),
          wallets: addresses.slice(0, WALLETS_PER_ROW), walletCount: addresses.length,
          funded: fundedIds.has(row.id),
        };
      });
      return { customers, nextCursor: rows.length > query.limit ? ids.at(-1) ?? null : null };
    });
  }

  profile(customerId: string): Promise<CustomerProfile | null> {
    return this.bounded(async (tx) => {
      const customer = (await tx.query<CustomerRow & { merged_into: string | null; retained_until: Date | null }>(
        `SELECT id, status, merged_into, merged_into IS NOT NULL AS merged, country, first_seen_at, first_seen_source, last_seen_at, retained_until
         FROM customers WHERE id=$1`, [customerId])).rows[0];
      if (!customer) return null;
      const credentials = await tx.query<CredentialRow & { linked_via: "first_use" | "link"; first_seen_at: Date; last_seen_at: Date }>(
        "SELECT customer_id, account_provider, email, email_source, linked_via, first_seen_at, last_seen_at FROM customer_credentials WHERE customer_id=$1 ORDER BY first_seen_at, id", [customerId]);
      const wallets = await tx.query<{ address: string; chain_id: number; created_at: Date }>(
        "SELECT address, chain_id, created_at FROM customer_wallets WHERE customer_id=$1 ORDER BY created_at, id", [customerId]);
      return {
        customerId: customer.id, status: customer.status, mergedInto: customer.merged_into, country: customer.country,
        firstSeenAt: iso(customer.first_seen_at), firstSeenSource: customer.first_seen_source, lastSeenAt: iso(customer.last_seen_at),
        deletionPending: customer.retained_until !== null,
        credentials: credentials.rows.map((credential) => ({
          signIn: credential.account_provider,
          email: credential.email && credential.email_source ? { address: credential.email, source: credential.email_source } : null,
          linkedVia: credential.linked_via, firstSeenAt: iso(credential.first_seen_at), lastSeenAt: iso(credential.last_seen_at),
        })),
        wallets: wallets.rows.flatMap((wallet) => {
          const address = parseAddress(wallet.address);
          return address ? [{ address, chainId: wallet.chain_id, linkedAt: iso(wallet.created_at) }] : [];
        }),
      };
    });
  }

  async detail(profile: CustomerProfile, balances: BalanceReader, signal?: AbortSignal): Promise<CustomerDetailResponse> {
    const id = profile.customerId;
    const baseWallets = profile.wallets.filter((wallet) => wallet.chainId === 8453).slice(0, BALANCE_WALLET_LIMIT).map((wallet) => wallet.address);
    const [balanceSection, actions, funding, verification, invites, support] = await Promise.all([
      section(balances(baseWallets, signal)),
      section(this.actions(id)),
      section(this.funding(id)),
      section(this.verification(id)),
      section(this.invites(id)),
      section(this.support(id)),
    ]);
    return { version: ADMIN_CUSTOMERS_CONTRACT_VERSION, profile, balances: balanceSection, actions, funding, verification, invites, support };
  }

  private actions(customerId: string): Promise<{ items: CustomerAction[]; more: boolean }> {
    return this.bounded(async (tx) => {
      const rows = (await tx.query<{
        id: string; kind: string; title: string | null; created_at: Date; confirmed_at: Date; handle_recorded_at: Date | null;
        transaction_hash: string | null; outcome: ActionOutcome | null; observed_receipt_transaction_hash: string | null;
        observed_receipt_block_hash: string | null; observed_receipt_block_number: string | null; observed_receipt_outcome: string | null;
      }>(`SELECT id, kind, left(summary->>'title', 120) AS title, created_at, confirmed_at, handle_recorded_at, transaction_hash, outcome,
          observed_receipt_transaction_hash, observed_receipt_block_hash, observed_receipt_block_number::text AS observed_receipt_block_number, observed_receipt_outcome
        FROM actions WHERE customer_id=$1 AND confirmed_at IS NOT NULL AND ${NON_DECLINED_ACTION_SQL}
        ORDER BY created_at DESC, id DESC LIMIT $2`, [customerId, CUSTOMER_DETAIL_PAGE_SIZE + 1])).rows;
      const items = rows.slice(0, CUSTOMER_DETAIL_PAGE_SIZE).map((row): CustomerAction => ({
        id: row.id, kind: row.kind.slice(0, 64), title: row.title?.trim() ? row.title.trim() : null,
        createdAt: iso(row.created_at), confirmedAt: iso(row.confirmed_at),
        status: deriveActionStatus({
          confirmedAt: iso(row.confirmed_at),
          submittedAt: row.handle_recorded_at ? iso(row.handle_recorded_at) : null,
          transactionHash: row.transaction_hash,
          receipt: observedReceiptState({
            transactionHash: row.transaction_hash,
            receiptTransactionHash: row.observed_receipt_transaction_hash,
            receiptBlockHash: row.observed_receipt_block_hash,
            receiptBlockNumber: row.observed_receipt_block_number,
            receiptOutcome: row.observed_receipt_outcome,
          }),
          outcome: row.outcome,
        }),
        outcome: row.outcome,
        transactionHash: parseHash32(row.transaction_hash),
      }));
      return { items, more: rows.length > CUSTOMER_DETAIL_PAGE_SIZE };
    });
  }

  private funding(customerId: string): Promise<{ items: CustomerFundingOrder[]; more: boolean }> {
    return this.bounded(async (tx) => {
      const rows = (await tx.query<{
        id: string; provider_id: string; region: string; asset_id: string; fiat_amount: string; state: string; sandbox: boolean;
        created_at: Date; updated_at: Date; provider_order_id: string | null; transaction_hash: string | null;
      }>(`SELECT id, provider_id, region, asset_id, fiat_amount, state, sandbox, created_at, updated_at, provider_order_id, transaction_hash
        FROM funding_orders WHERE customer_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`, [customerId, CUSTOMER_DETAIL_PAGE_SIZE + 1])).rows;
      const items = rows.slice(0, CUSTOMER_DETAIL_PAGE_SIZE).map((row): CustomerFundingOrder => ({
        id: row.id, providerId: row.provider_id, region: row.region, assetId: row.asset_id, fiatAmount: row.fiat_amount, state: row.state,
        sandbox: row.sandbox, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
        providerOrderId: row.provider_order_id && row.provider_order_id.length <= 128 ? row.provider_order_id : null,
        transactionHash: parseHash32(row.transaction_hash),
      }));
      return { items, more: rows.length > CUSTOMER_DETAIL_PAGE_SIZE };
    });
  }

  private verification(customerId: string) {
    return this.bounded(async (tx) => (await tx.query<{ provider_id: string; region: string; state: "reserving" | "pending" | "verified" | "rejected" | "dispatch-ambiguous"; updated_at: Date }>(
      "SELECT provider_id, region, state, updated_at FROM funding_provider_customers WHERE customer_id=$1 ORDER BY updated_at DESC, id DESC LIMIT $2",
      [customerId, CUSTOMER_DETAIL_PAGE_SIZE])).rows.map((row) => ({ providerId: row.provider_id, region: row.region, state: row.state, updatedAt: iso(row.updated_at) })));
  }

  private invites(customerId: string) {
    return this.bounded(async (tx) => {
      const row = (await tx.query<{ attributed_code: string | null; inviter: string | null; own_code: string | null; attributed: string | null }>(
        `SELECT c.invite_code AS attributed_code, inviter.customer_id AS inviter, own.code AS own_code,
          CASE WHEN own.code IS NULL THEN NULL ELSE (SELECT count(*) FROM customers a WHERE a.invite_code=own.code)::text END AS attributed
         FROM customers c
         LEFT JOIN invite_codes inviter ON inviter.code=c.invite_code
         LEFT JOIN invite_codes own ON own.customer_id=c.id
         WHERE c.id=$1`, [customerId])).rows[0];
      if (!row) throw new Error("Customer invite attribution is unavailable");
      return {
        attributedCode: row.attributed_code, inviterCustomerId: row.inviter, ownCode: row.own_code,
        attributedSignups: row.attributed === null ? null : Number(row.attributed),
      };
    });
  }

  private support(customerId: string) {
    return this.bounded(async (tx) => {
      const row = (await tx.query<{ id: string; status: "open" | "resolved"; last_message_at: Date }>(
        "SELECT id, status, last_message_at FROM support_conversations WHERE customer_id=$1", [customerId])).rows[0];
      return row ? { conversationId: row.id, status: row.status, lastMessageAt: iso(row.last_message_at) } : null;
    });
  }
}

function emails(credentials: readonly CredentialRow[]): CustomerEmail[] {
  const seen = new Map<string, CustomerEmail>();
  for (const credential of credentials) {
    if (!credential.email || !credential.email_source) continue;
    const existing = seen.get(credential.email);
    if (!existing || credential.email_source === "cdp_verified") seen.set(credential.email, { address: credential.email, source: credential.email_source });
  }
  return [...seen.values()];
}
