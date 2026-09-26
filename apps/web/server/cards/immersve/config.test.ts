import { describe, expect, test } from "bun:test";
import { readImmersveConfig } from "./config";

const enabled = {
  IMMERSVE_ENABLED: "1",
  IMMERSVE_MODE: "production",
  IMMERSVE_API_KEY: "synthetic-key",
  IMMERSVE_API_SECRET: "synthetic-secret",
  IMMERSVE_PARTNER_ACCOUNT_ID: "a".repeat(32),
  IMMERSVE_CLIENT_APPLICATION_ID: "b".repeat(32),
  IMMERSVE_CARD_PROGRAM_ID: "c".repeat(32),
  IMMERSVE_FUNDING_CHANNEL_ID: "d".repeat(32),
  IMMERSVE_FUNDS_STORAGE_ADDRESS: "0x1111111111111111111111111111111111111111",
  IMMERSVE_FUNDING_TYPE: "base-mainnet-usdc-universal-evm",
};

describe("Immersve configuration", () => {
  test("remains inert without the exact enable flag", () => {
    expect(readImmersveConfig({ ...enabled, IMMERSVE_ENABLED: "true" })).toBeNull();
  });
  test("pins mode, origin, and funding type", () => {
    expect(readImmersveConfig(enabled)?.origin).toBe("https://api.immersve.com");
    expect(readImmersveConfig({ ...enabled, IMMERSVE_MODE: "sandbox", IMMERSVE_FUNDING_TYPE: "base-sepolia-usdc-universal-evm" })?.origin).toBe("https://test.immersve.com");
    for (const mode of ["", "Sandbox", "1"]) {
      expect(() => readImmersveConfig({ ...enabled, IMMERSVE_MODE: mode })).toThrow();
    }
    expect(() => readImmersveConfig({ ...enabled, IMMERSVE_MODE: undefined })).toThrow();
    expect(() => readImmersveConfig({ ...enabled, IMMERSVE_MODE: "sandbox" })).toThrow();
  });
  test("rejects incomplete configuration and malformed IDs", () => {
    for (const name of Object.keys(enabled).filter((key) => key !== "IMMERSVE_ENABLED")) {
      expect(() => readImmersveConfig({ ...enabled, [name]: "" })).toThrow();
    }
    expect(() => readImmersveConfig({ ...enabled, IMMERSVE_FUNDING_CHANNEL_ID: "not-an-id" })).toThrow();
  });
  test("refuses Funds Manager, public Amoy, and zero addresses and channel", () => {
    for (const address of [
      "0xcd1c3d1c12437bD0375E3C4331771b31220125Bd",
      "0xe50FF3C352C0176c12c0a130dCa7655eC518fc40",
      "0xF9e148F4D48350042fB8F18e98b089c9aDA07BfB",
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(() => readImmersveConfig({ ...enabled, IMMERSVE_FUNDS_STORAGE_ADDRESS: address })).toThrow();
    }
    expect(() => readImmersveConfig({ ...enabled, IMMERSVE_FUNDING_CHANNEL_ID: "4cdc4310718674342d561647194e2446" })).toThrow();
  });
});
