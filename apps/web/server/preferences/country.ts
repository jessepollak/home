import "server-only";

import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { CustomerResolver, getCustomerResolver } from "@/server/customers/resolve";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

export class CountryPreferenceStore {
  constructor(private readonly sql: SqlExecutor, private readonly customers: CustomerResolver) {}

  async readCountryPreference(session: VerifiedAccountSession): Promise<CountryCode | null> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const read = this.sql.query<{ country_preference: string | null }>(
        `SELECT cp.country_preference FROM customer_credentials cr
         LEFT JOIN customer_preferences cp ON cp.customer_id=cr.customer_id
         WHERE cr.account_provider=$1 AND cr.subject=$2`,
        [session.accountProvider, session.user.subject], { timeoutMs: 750, signal: controller.signal },
      );
      const result = await Promise.race([
        read,
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => {
          controller.abort();
          reject(new Error("Country preference read timed out"));
        }, 750); }),
      ]);
      return normalizeCountryCode(result.rows[0]?.country_preference);
    } finally {
      clearTimeout(deadline);
    }
  }

  async writeCountryPreference(
    session: VerifiedAccountSession,
    regionId: CountryCode,
    { onlyIfUnset }: { onlyIfUnset: boolean },
  ): Promise<CountryCode> {
    const normalized = normalizeCountryCode(regionId);
    if (!normalized) throw new Error("Invalid country preference");
    const customer = await this.customers.resolveCustomer(session, { create: true });
    const result = await this.sql.query<{ country_preference: string }>(
      `INSERT INTO customer_preferences (customer_id,country_preference) VALUES ($1,$2)
       ON CONFLICT (customer_id) DO UPDATE SET country_preference=EXCLUDED.country_preference,updated_at=now()
       ${onlyIfUnset ? "WHERE customer_preferences.country_preference IS NULL" : ""}
       RETURNING country_preference`,
      [customer.id, normalized],
    );
    const stored = result.rows[0]?.country_preference ?? (await this.sql.query<{ country_preference: string | null }>(
      "SELECT country_preference FROM customer_preferences WHERE customer_id=$1", [customer.id],
    )).rows[0]?.country_preference;
    const value = normalizeCountryCode(stored);
    if (!value) throw new Error("Country preference could not be saved");
    return value;
  }
}

function runtimeStore(): CountryPreferenceStore | null {
  const customers = getCustomerResolver();
  return customers ? new CountryPreferenceStore(getSqlExecutor(), customers) : null;
}

export async function readCountryPreference(session: VerifiedAccountSession, store: CountryPreferenceStore | null = runtimeStore()): Promise<CountryCode | null> {
  return store ? store.readCountryPreference(session) : null;
}

export async function readCountryPreferenceForRender(session: VerifiedAccountSession, store: CountryPreferenceStore | null = runtimeStore()): Promise<{ regionId: CountryCode | null } | null> {
  try {
    return { regionId: await readCountryPreference(session, store) };
  } catch {
    return null;
  }
}

export async function writeCountryPreference(session: VerifiedAccountSession, regionId: CountryCode, options: { onlyIfUnset: boolean }): Promise<CountryCode> {
  const store = runtimeStore();
  if (!store) throw new Error("Country preference store is unavailable");
  return store.writeCountryPreference(session, regionId, options);
}
