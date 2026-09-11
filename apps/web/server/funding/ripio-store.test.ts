import { describe, expect, test } from "bun:test";
import { PostgresRipioStore, RIPIO_SCHEMA_SQL, ripioSchemaStatements } from "./ripio-store";

describe("Ripio durable store schema", () => {
  test("separates stable customer, Home order, provider quote/order, and webhook dedupe references", () => {
    expect(RIPIO_SCHEMA_SQL).toContain("home_customer_key TEXT PRIMARY KEY");
    expect(RIPIO_SCHEMA_SQL).toContain("home_order_id TEXT PRIMARY KEY");
    expect(RIPIO_SCHEMA_SQL).toContain("provider_quote_id TEXT NOT NULL");
    expect(RIPIO_SCHEMA_SQL).toContain("provider_order_id TEXT NOT NULL UNIQUE");
    expect(RIPIO_SCHEMA_SQL).toContain("event_id TEXT PRIMARY KEY");
    expect(ripioSchemaStatements.length).toBe(6);
    expect(RIPIO_SCHEMA_SQL).toContain("ripio_webhook_inbox");
    expect(RIPIO_SCHEMA_SQL).toContain("version INTEGER NOT NULL");
  });

  test("uses row locking plus version compare-and-swap for concurrent reconciliation", () => {
    const source = PostgresRipioStore.prototype.applyVerifiedObservation.toString();
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("updateOrder");
    expect(RIPIO_SCHEMA_SQL).toContain("version INTEGER NOT NULL");
  });

  test("keeps unmatched inbox recovery pending until it atomically locks and updates the order", () => {
    const source = PostgresRipioStore.prototype.resolveInbox.toString();
    expect(source.match(/FOR UPDATE/g)?.length).toBe(2);
    expect(source).toContain("updateOrder");
    expect(source).toContain("recovery_state='reconciled'");
  });

  test("does not define credential, access token, email, bank, or raw webhook body columns", () => {
    const normalized = RIPIO_SCHEMA_SQL.toLowerCase();
    for (const forbidden of ["client_secret", "access_token", "email", "cvu", "phone_number", "raw_body text"]) {
      expect(normalized).not.toContain(forbidden);
    }
  });
});
