import "server-only";

import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import type { TradeIntent, TradeIntentStore } from "@/shared/trading/server-types";

type IntentRow = {
  intent_json: string;
  final_action_id: string | null;
  signature_digest: string | null;
};

export class SqliteTradeIntentStore implements TradeIntentStore {
  private readonly database: DatabaseSync;

  constructor(path = resolve(process.cwd(), ".local", "home-trade-intents.sqlite")) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS trade_intents (
        id TEXT PRIMARY KEY,
        intent_hash TEXT NOT NULL,
        subject TEXT NOT NULL,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
        account_provider TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        final_action_id TEXT UNIQUE,
        signature_digest TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trade_intent_owner
      ON trade_intents(subject, address, chain_id, account_provider, created_at DESC);
    `);
  }

  async issue(intent: TradeIntent): Promise<void> {
    this.database.prepare(`
      INSERT INTO trade_intents (
        id, intent_hash, subject, address, chain_id, account_provider,
        intent_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intent.id,
      intent.intentHash,
      intent.owner.subject,
      intent.owner.address,
      intent.owner.chainId,
      intent.owner.accountProvider,
      JSON.stringify(intent),
      intent.createdAt,
      intent.expiresAt,
    );
  }

  async get(owner: MoneyActionOwner, id: string): Promise<TradeIntent | null> {
    const row = this.readRow(owner, id);
    return row ? parseIntent(row) : null;
  }

  async getByFinalActionId(owner: MoneyActionOwner, actionId: string): Promise<TradeIntent | null> {
    const row = (this.database.prepare(`
      SELECT intent_json, final_action_id, signature_digest
      FROM trade_intents
      WHERE final_action_id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
    `).get(
      actionId,
      owner.subject,
      owner.address.toLowerCase(),
      owner.chainId,
      owner.accountProvider,
    ) as IntentRow | undefined) ?? null;
    return row ? parseIntent(row) : null;
  }

  async bindFinalAction(input: {
    owner: MoneyActionOwner;
    id: string;
    intentHash: string;
    finalActionId: string;
    signatureDigest: string;
  }): Promise<TradeIntent | null> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.readRow(input.owner, input.id);
      if (!row) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const intent = parseIntent(row);
      if (
        intent.intentHash !== input.intentHash ||
        (intent.finalActionId && intent.finalActionId !== input.finalActionId) ||
        (intent.signatureDigest && intent.signatureDigest !== input.signatureDigest)
      ) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const next = {
        ...intent,
        finalActionId: intent.finalActionId ?? input.finalActionId,
        signatureDigest: intent.signatureDigest ?? input.signatureDigest,
      };
      const changed = this.database.prepare(`
        UPDATE trade_intents
        SET final_action_id = ?, signature_digest = ?, intent_json = ?
        WHERE id = ? AND intent_hash = ?
          AND (final_action_id IS NULL OR final_action_id = ?)
          AND (signature_digest IS NULL OR signature_digest = ?)
      `).run(
        next.finalActionId,
        next.signatureDigest,
        JSON.stringify(next),
        input.id,
        input.intentHash,
        input.finalActionId,
        input.signatureDigest,
      );
      if (changed.changes !== 1) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private readRow(owner: MoneyActionOwner, id: string): IntentRow | null {
    return (this.database.prepare(`
      SELECT intent_json, final_action_id, signature_digest
      FROM trade_intents
      WHERE id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
    `).get(
      id,
      owner.subject,
      owner.address.toLowerCase(),
      owner.chainId,
      owner.accountProvider,
    ) as IntentRow | undefined) ?? null;
  }
}

function parseIntent(row: IntentRow): TradeIntent {
  const value: unknown = JSON.parse(row.intent_json);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid-trade-intent");
  }
  const intent = value as TradeIntent;
  if (row.final_action_id && intent.finalActionId !== row.final_action_id) {
    throw new Error("invalid-trade-intent");
  }
  if (row.signature_digest && intent.signatureDigest !== row.signature_digest) {
    throw new Error("invalid-trade-intent");
  }
  if (
    intent.version !== 1 ||
    typeof intent.id !== "string" ||
    typeof intent.intentHash !== "string" ||
    !intent.owner ||
    typeof intent.owner.subject !== "string" ||
    typeof intent.owner.address !== "string" ||
    intent.owner.chainId !== 8453
  ) throw new Error("invalid-trade-intent");
  return intent;
}
