import { expect, test } from "bun:test";
import { brandSettingsPutRequest, parseBrandSettings, parseBrandSettingsResponse } from "./contract";

const brand = { displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" };
const entry = { value: brand, revision: 3, source: "stored", updatedAt: "2026-09-24T12:00:00.000Z", updatedBy: "0x3333333333333333333333333333333333333333" };

test("brand settings round-trip the four stored fields within their limits", () => {
  expect<unknown>(parseBrandSettings(brand)).toEqual({ displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" });
  expect<unknown>(parseBrandSettings({ ...brand, displayName: "A".repeat(40), description: "B".repeat(160) })).not.toBeNull();
});

test("brand text is trimmed, bounded and free of control and bidirectional characters", () => {
  for (const value of [
    { ...brand, displayName: "" },
    { ...brand, displayName: "A".repeat(41) },
    { ...brand, displayName: " Acme Money" },
    { ...brand, displayName: "Acme\u0007Money" },
    { ...brand, displayName: "Acme\u202eMoney" },
    { ...brand, description: "" },
    { ...brand, description: "B".repeat(161) },
    { ...brand, description: "Money for Acme customers. " },
    { ...brand, description: "Money\u200e for Acme" },
  ]) {
    expect(parseBrandSettings(value)).toBeNull();
  }
});

test("brand colors are lowercase six-digit hex values", () => {
  for (const value of [
    { ...brand, primaryColor: "#0B6B3A" },
    { ...brand, primaryColor: "#0b6b3" },
    { ...brand, primaryColor: "0b6b3a" },
    { ...brand, primaryColor: "#0b6b3a;}body{display:none" },
    { ...brand, backgroundColor: "#F5F8F2" },
    { ...brand, backgroundColor: "#fff" },
    { ...brand, backgroundColor: "white" },
  ]) {
    expect(parseBrandSettings(value)).toBeNull();
  }
});

test("brand settings reject any shape other than four plain fields", () => {
  for (const value of [
    null,
    [brand],
    { ...brand, extra: "x" },
    { displayName: brand.displayName, description: brand.description, primaryColor: brand.primaryColor },
    { ...brand, primaryColor: 12 },
    Object.assign(Object.create({ inherited: true }), brand),
  ]) {
    expect(parseBrandSettings(value)).toBeNull();
  }
});

test("brand responses carry a parsed value only for the brand domain and contract version", () => {
  expect<unknown>(parseBrandSettingsResponse({ version: 2, domain: "brand", settings: entry })).toEqual({
    version: 2,
    domain: "brand",
    settings: { value: { displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" }, revision: 3, source: "stored", updatedAt: "2026-09-24T12:00:00.000Z", updatedBy: "0x3333333333333333333333333333333333333333" },
  });
  for (const value of [
    { version: 2, domain: "support", settings: entry },
    { version: 1, domain: "brand", settings: entry },
    { version: 2, domain: "brand", settings: { ...entry, value: { ...brand, primaryColor: "red" } } },
    { version: 2, domain: "brand", settings: { ...entry, value: { displayName: "Acme Money" } } },
  ]) {
    expect(parseBrandSettingsResponse(value)).toBeNull();
  }
});

test("brand put requests bind the operator, the revision and the contract version", () => {
  expect<unknown>(brandSettingsPutRequest(3, brand, "0x1111111111111111111111111111111111111111")).toEqual({
    version: 2,
    expectedRevision: 3,
    value: brand,
    operator: "0x1111111111111111111111111111111111111111",
  });
});
