import "server-only";

import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import { COUNTRY_DEFAULT_CURRENCY, isCurrencyShape, parseDisplayCurrencyChoice, type DisplayCurrencyChoice } from "@/shared/account/display-currency";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { CustomerResolver, getCustomerResolver } from "@/server/customers/resolve";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

type CountryPreference = { regionId: CountryCode | null; displayCurrency: string | null };
type CountryPreferenceUpdate = { regionId?: CountryCode; displayCurrency?: DisplayCurrencyChoice };
type PreferenceRow = { country_preference: string | null; display_currency: string | null };

function preferenceFromRow(row: PreferenceRow | undefined): CountryPreference {
  const stored = row?.display_currency;
  return {
    regionId: normalizeCountryCode(row?.country_preference),
    displayCurrency: stored === COUNTRY_DEFAULT_CURRENCY || isCurrencyShape(stored) ? stored : null,
  };
}

const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";

export class CountryPreferenceStore {
  constructor(private readonly sql: SqlExecutor, private readonly customers: CustomerResolver) {}

  async readCountryPreference(session: VerifiedAccountSession): Promise<CountryPreference> {
    const signal = AbortSignal.timeout(750);
    let onAbort = () => {};
    try {
      const read = this.sql.query<PreferenceRow>(
        `SELECT cp.country_preference,cp.display_currency FROM customer_credentials cr
         LEFT JOIN customer_preferences cp ON cp.customer_id=cr.customer_id
         WHERE cr.account_provider=$1 AND cr.subject=$2`,
        [session.accountProvider, session.user.subject], { timeoutMs: 750, signal },
      );
      const result = await Promise.race([
        read,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error("Country preference read timed out"));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      return preferenceFromRow(result.rows[0]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async writeCountryPreference(
    session: VerifiedAccountSession,
    input: CountryPreferenceUpdate,
    { onlyIfUnset }: { onlyIfUnset: boolean },
  ): Promise<CountryPreference> {
    const regionId = input.regionId === undefined ? null : normalizeCountryCode(input.regionId);
    const displayCurrency = input.displayCurrency === undefined ? null : parseDisplayCurrencyChoice(input.displayCurrency);
    if (input.regionId !== undefined && !regionId) throw new Error("Invalid country preference");
    if (input.displayCurrency !== undefined && !displayCurrency) throw new Error("Invalid display currency");
    if (regionId === null && displayCurrency === null) throw new Error("Missing preference");
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      const customer = await this.customers.resolveCustomerInTransaction(tx, session);
      const result = await tx.query<PreferenceRow>(
        `INSERT INTO customer_preferences (customer_id,country_preference,display_currency) VALUES ($1,$2,$3)
         ON CONFLICT (customer_id) DO UPDATE SET
           country_preference=CASE WHEN $4::boolean THEN COALESCE(customer_preferences.country_preference,EXCLUDED.country_preference)
             ELSE COALESCE(EXCLUDED.country_preference,customer_preferences.country_preference) END,
           display_currency=CASE WHEN $4::boolean THEN COALESCE(customer_preferences.display_currency,EXCLUDED.display_currency)
             ELSE COALESCE(EXCLUDED.display_currency,customer_preferences.display_currency) END,
           updated_at=now()
         RETURNING country_preference,display_currency`,
        [customer.id, regionId, displayCurrency, onlyIfUnset],
      );
      if (!result.rows[0]) throw new Error("Country preference could not be saved");
      return preferenceFromRow(result.rows[0]);
    });
  }
}

function runtimeStore(): CountryPreferenceStore | null {
  const customers = getCustomerResolver();
  return customers ? new CountryPreferenceStore(getSqlExecutor(), customers) : null;
}

export async function readCountryPreference(session: VerifiedAccountSession, store: CountryPreferenceStore | null = runtimeStore()): Promise<CountryPreference | null> {
  return store ? store.readCountryPreference(session) : null;
}

export async function readCountryPreferenceForRender(session: VerifiedAccountSession, store?: CountryPreferenceStore | null): Promise<CountryPreference | null> {
  try {
    return await readCountryPreference(session, store) ?? { regionId: null, displayCurrency: null };
  } catch {
    return null;
  }
}

export async function writeCountryPreference(session: VerifiedAccountSession, input: CountryPreferenceUpdate, options: { onlyIfUnset: boolean }): Promise<CountryPreference> {
  const store = runtimeStore();
  if (!store) throw new Error("Country preference store is unavailable");
  return store.writeCountryPreference(session, input, options);
}
