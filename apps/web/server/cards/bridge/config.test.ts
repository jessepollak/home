import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readBridgeConfig } from "./config";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
const enabled = {
  BRIDGE_ENABLED: "1",
  BRIDGE_MODE: "sandbox",
  BRIDGE_WEBHOOK_PUBLIC_KEY: key,
  BRIDGE_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_private_fixture",
  BRIDGE_PROGRAM_SPENDER: "0x65bf8b55EEDef53C094E40003a03390De744DF33",
};

describe("Bridge configuration https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox", () => {
  test("is inert by default and pins mode, origin, chain and USDC", () => {
    expect(readBridgeConfig({ ...enabled, BRIDGE_ENABLED: "true" })).toBeNull();
    expect(readBridgeConfig({ ...enabled, BRIDGE_ENABLED: "" })).toBeNull();
    expect(readBridgeConfig(enabled)).toMatchObject({ mode: "sandbox", origin: "https://api.sandbox.bridge.xyz", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" });
    expect(readBridgeConfig({ ...enabled, BRIDGE_MODE: "production" })?.origin).toBe("https://api.bridge.xyz");
    for (const mode of ["", "test", "Sandbox"]) expect(() => readBridgeConfig({ ...enabled, BRIDGE_MODE: mode })).toThrow();
  });
  test("fails closed on incomplete config and invalid spender", () => {
    for (const name of Object.keys(enabled).filter((key) => key !== "BRIDGE_ENABLED")) {
      expect(() => readBridgeConfig({ ...enabled, [name]: "" })).toThrow();
    }
    for (const address of ["0x0000000000000000000000000000000000000000", "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "0x65bf8b55eedef53c094e40003a03390de744df33", "0xinvalid"]) {
      expect(() => readBridgeConfig({ ...enabled, BRIDGE_PROGRAM_SPENDER: address })).toThrow();
    }
    expect(() => readBridgeConfig({ ...enabled, BRIDGE_WEBHOOK_PUBLIC_KEY: "not-pem" })).toThrow();
    expect(() => readBridgeConfig({ ...enabled, BRIDGE_STRIPE_WEBHOOK_SECRET: "not-stripe" })).toThrow();
  });
});
