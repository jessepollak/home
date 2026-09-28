import { describe, expect, test } from "bun:test";
import { readCardJourneyConfig } from "./journey-config";

const env = { BRIDGE_CARDS_ENABLED: "1", BRIDGE_MODE: "sandbox", BRIDGE_API_KEY: "bridge-test",
  BRIDGE_STRIPE_SECRET_KEY: "sk_test_fake", BRIDGE_STRIPE_API_VERSION: "2026-08-26.dahlia",
  BRIDGE_STRIPE_CARD_FUNDING: "financial_account", BRIDGE_STRIPE_FINANCIAL_ACCOUNT: "fa_test" };

describe("card journey config guard", () => {
  test("disabled separately from webhook configuration", () => {
    expect(readCardJourneyConfig({ ...env, BRIDGE_CARDS_ENABLED: "0" })).toBeNull();
    expect(readCardJourneyConfig(env)?.funding).toEqual({ kind: "financial_account", financialAccount: "fa_test" });
  });
  test("keys match the environment and production only allows crypto wallets", () => {
    expect(() => readCardJourneyConfig({ ...env, BRIDGE_STRIPE_SECRET_KEY: "sk_live_fake" })).toThrow();
    expect(() => readCardJourneyConfig({ ...env, BRIDGE_MODE: "production" })).toThrow();
    expect(() => readCardJourneyConfig({ ...env, BRIDGE_MODE: "production", BRIDGE_STRIPE_CARD_FUNDING: "crypto_wallet", BRIDGE_STRIPE_FINANCIAL_ACCOUNT: undefined, BRIDGE_STRIPE_SECRET_KEY: "sk_test_fake" })).toThrow();
    expect(readCardJourneyConfig({ ...env, BRIDGE_MODE: "production", BRIDGE_STRIPE_CARD_FUNDING: "crypto_wallet", BRIDGE_STRIPE_FINANCIAL_ACCOUNT: undefined, BRIDGE_STRIPE_SECRET_KEY: "sk_live_fake" })?.bridgeOrigin).toBe("https://api.bridge.xyz");
    expect(() => readCardJourneyConfig({ ...env, BRIDGE_STRIPE_API_VERSION: "2026-02-30.dahlia" })).toThrow();
  });
  test("override is sandbox loopback only", () => {
    expect(readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: "http://127.0.0.1:3456" })?.bridgeOrigin).toBe("http://127.0.0.1:3456");
    for (const url of ["https://127.0.0.1:3456", "http://127.0.0.2:3456", "http://localhost.evil.com", "http://localhost:3456/path", "http://user@localhost:3456"]) {
      expect(() => readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: url })).toThrow();
    }
    expect(() => readCardJourneyConfig({ ...env, BRIDGE_MODE: "production", BRIDGE_STRIPE_CARD_FUNDING: "crypto_wallet", BRIDGE_STRIPE_FINANCIAL_ACCOUNT: undefined, BRIDGE_STRIPE_SECRET_KEY: "sk_live_fake", BRIDGE_API_BASE_URL: "http://127.0.0.1:3456" })).toThrow();
  });
});
