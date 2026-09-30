import "server-only";

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readCardAllowanceRegistry, readCardSpenderBlocklist, cardAllowanceSetEnabled } from "./config";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
const current = "0x65bf8b55EEDef53C094E40003a03390De744DF33";
const retired = "0x3333333333333333333333333333333333333333";
const env = { BRIDGE_ENABLED: "1", BRIDGE_MODE: "production", BRIDGE_STRIPE_API_VERSION: "2026-08-27.basil",
  BRIDGE_WEBHOOK_PUBLIC_KEY: key, BRIDGE_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_private_fixture",
  BRIDGE_PROGRAM_SPENDER: current, BRIDGE_PROGRAM_RETIRED_SPENDERS: retired, BRIDGE_CARD_ALLOWANCE_MAX_USDC: "100" };

describe("Bridge card allowance registry", () => {
  test("requires a valid Bridge program and converts whole USDC to base units", () => {
    expect(readCardAllowanceRegistry({ ...env, BRIDGE_ENABLED: "" })).toBeNull();
    expect(readCardAllowanceRegistry(env)).toMatchObject({ current: current.toLowerCase(), retired: [retired], maximumBaseUnits: "100000000" });
    expect(readCardAllowanceRegistry({ ...env, BRIDGE_CARD_ALLOWANCE_MAX_USDC: "1000000" })?.maximumBaseUnits).toBe("1000000000000");
    expect(readCardAllowanceRegistry({ ...env, BRIDGE_CARD_ALLOWANCE_MAX_USDC: undefined })?.maximumBaseUnits).toBeNull();
  });
  test.each(["0", "-1", "1.5", "01", "1000001", "invalid", " 10 "])("rejects invalid maximum %s", (maximum) => {
    expect(() => readCardAllowanceRegistry({ ...env, BRIDGE_CARD_ALLOWANCE_MAX_USDC: maximum })).toThrow();
  });
  test.each([current, `${retired},${retired}`, `${retired},`, "0x0000000000000000000000000000000000000000",
    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "0x65bf8b55eedef53c094e40003a03390de744df33", "invalid"])("rejects an invalid retired list %s", (value) => {
    expect(() => readCardAllowanceRegistry({ ...env, BRIDGE_PROGRAM_RETIRED_SPENDERS: value })).toThrow();
  });
  test("caps the strict registry at eight retired spenders but keeps every raw spender blocked", () => {
    const spenders = Array.from({ length: 9 }, (_, index): `0x${string}` => `0x${(index + 2).toString(16).padStart(40, "0")}`);
    const eight = { ...env, BRIDGE_PROGRAM_RETIRED_SPENDERS: spenders.slice(0, 8).join(",") };
    expect(readCardAllowanceRegistry(eight)?.retired).toEqual(spenders.slice(0, 8));
    const nine = { ...eight, BRIDGE_PROGRAM_RETIRED_SPENDERS: spenders.join(",") };
    expect(() => readCardAllowanceRegistry(nine)).toThrow("Invalid retired Bridge spender registry");
    expect([...readCardSpenderBlocklist(nine)].map(String)).toEqual([current.toLowerCase(), ...spenders]);
  });
  test("blocklist collects valid raw spenders even when Bridge and the registry are invalid", () => {
    const blocked = readCardSpenderBlocklist({ ...env, BRIDGE_ENABLED: undefined,
      BRIDGE_PROGRAM_RETIRED_SPENDERS: `${retired},broken,0x4444444444444444444444444444444444444444` });
    expect([...blocked]).toEqual(["0x65bf8b55eedef53c094e40003a03390de744df33", "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"]);
    expect([...readCardSpenderBlocklist({ BRIDGE_PROGRAM_SPENDER: "invalid", BRIDGE_PROGRAM_RETIRED_SPENDERS: "," })]).toEqual([]);
  });
  test("gates setting on matching production crypto-wallet journey while keeping revoke registry independent", () => {
    const registry = readCardAllowanceRegistry(env);
    expect(cardAllowanceSetEnabled(registry, () => ({ mode: "production", funding: { kind: "crypto_wallet" } }))).toBe(true);
    expect(cardAllowanceSetEnabled(registry, () => ({ mode: "sandbox", funding: { kind: "crypto_wallet" } }))).toBe(false);
    expect(cardAllowanceSetEnabled(registry, () => ({ mode: "production", funding: { kind: "financial_account" } }))).toBe(false);
    expect(cardAllowanceSetEnabled(registry, () => null)).toBe(false);
  });
});
