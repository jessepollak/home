import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

export type WebhookSubscriptionRecord = {
  subscriptionId: string;
  secret: string;
  target: string;
  eventType: string;
  createdAt: string;
};

export interface WebhookSubscriptionStore {
  readonly persistent: boolean;
  insert(record: Omit<WebhookSubscriptionRecord, "createdAt">): Promise<void>;
  list(): Promise<WebhookSubscriptionRecord[]>;
}

export class PostgresWebhookSubscriptionStore implements WebhookSubscriptionStore {
  readonly persistent = true;
  constructor(private readonly sql: SqlExecutor) {}

  async insert(record: Omit<WebhookSubscriptionRecord, "createdAt">): Promise<void> {
    await this.sql.query(
      `INSERT INTO webhook_subscriptions (subscription_id,secret,target,event_type)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (subscription_id) DO UPDATE SET
         secret=EXCLUDED.secret,target=EXCLUDED.target,event_type=EXCLUDED.event_type`,
      [record.subscriptionId, record.secret, record.target, record.eventType],
    );
  }

  async list(): Promise<WebhookSubscriptionRecord[]> {
    const result = await this.sql.query<Record<string, unknown>>(
      "SELECT subscription_id,secret,target,event_type,created_at FROM webhook_subscriptions ORDER BY created_at,subscription_id",
    );
    return result.rows.map((row) => ({
      subscriptionId: String(row.subscription_id),
      secret: String(row.secret),
      target: String(row.target),
      eventType: String(row.event_type),
      createdAt: timestamp(row.created_at),
    }));
  }
}

export class MemoryWebhookSubscriptionStore implements WebhookSubscriptionStore {
  readonly persistent = false;
  private readonly records = new Map<string, WebhookSubscriptionRecord>();

  async insert(record: Omit<WebhookSubscriptionRecord, "createdAt">): Promise<void> {
    this.records.set(record.subscriptionId, {
      ...structuredClone(record),
      createdAt: new Date().toISOString(),
    });
  }

  async list(): Promise<WebhookSubscriptionRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  clearForTests(): void {
    this.records.clear();
  }
}

let runtimeStore: WebhookSubscriptionStore | null = null;
export function getWebhookSubscriptionStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebhookSubscriptionStore {
  if (runtimeStore) return runtimeStore;
  runtimeStore = env.DATABASE_URL?.trim()
    ? new PostgresWebhookSubscriptionStore(getSqlExecutor(env))
    : new MemoryWebhookSubscriptionStore();
  return runtimeStore;
}

function timestamp(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
