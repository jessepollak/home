import { expect, test } from "bun:test";
import { brandSettingsPutRequest, parseBrandSettings, parseBrandSettingsResponse, upgradeBrandSettings } from "./contract";

const v1 = { displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" };
const brand = { ...v1, logoUrl: null, termsUrl: null, privacyUrl: null };
const entry = { value: brand, revision: 3, source: "stored", updatedAt: "2026-09-24T12:00:00.000Z", updatedBy: "0x3333333333333333333333333333333333333333" };

test("brand settings round-trip the stored fields within their limits", () => {
  expect<unknown>(parseBrandSettings(brand)).toEqual({ displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2", logoUrl: null, termsUrl: null, privacyUrl: null });
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

test("brand settings reject any shape other than the seven plain fields", () => {
  for (const value of [
    null,
    [brand],
    { ...brand, extra: "x" },
    { displayName: brand.displayName, description: brand.description, primaryColor: brand.primaryColor },
    v1,
    { ...v1, logoUrl: null },
    { ...brand, primaryColor: 12 },
    Object.assign(Object.create({ inherited: true }), brand),
  ]) {
    expect(parseBrandSettings(value)).toBeNull();
  }
});

test("brand links and logo accept only https addresses, and empty means unset", () => {
  const links = { logoUrl: "https://cdn.acme.example/logo.svg", termsUrl: "https://acme.example/terms?lang=en#top", privacyUrl: "https://acme.example/privacy" };
  expect<unknown>(parseBrandSettings({ ...brand, ...links })).toEqual({ ...brand, ...links });
  expect<unknown>(parseBrandSettings({ ...brand, logoUrl: "", termsUrl: "", privacyUrl: "" })).toEqual(brand);
  expect(parseBrandSettings({ ...brand, termsUrl: `https://acme.example/${"a".repeat(2048 - 21)}` })).not.toBeNull();
  for (const url of [
    "http://acme.example/logo.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//acme.example/logo.png",
    "https:acme.example/logo.png",
    "HTTPS://acme.example/logo.png",
    "/logo.png",
    "https://user:pass@acme.example/logo.png",
    "https://user@acme.example/logo.png",
    " https://acme.example/logo.png",
    "https://acme.example/logo one.png",
    "https://acme.example/\u202elogo.png",
    `https://acme.example/${"a".repeat(2048 - 20)}`,
    "not a url",
    42,
  ]) {
    for (const field of ["logoUrl", "termsUrl", "privacyUrl"] as const) {
      expect(parseBrandSettings({ ...brand, [field]: url })).toBeNull();
    }
  }
});

test("a schema 1 brand row upgrades to unset links and logo without touching its other fields", () => {
  expect<unknown>(parseBrandSettings(upgradeBrandSettings(1, v1))).toEqual(brand);
  expect(() => upgradeBrandSettings(1, { ...v1, logoUrl: "https://acme.example/logo.png" })).toThrow();
  expect(() => upgradeBrandSettings(2, brand)).toThrow();
  expect(() => upgradeBrandSettings(1, null)).toThrow();
});

test("brand responses carry a parsed value only for the brand domain and contract version", () => {
  expect<unknown>(parseBrandSettingsResponse({ version: 2, domain: "brand", settings: entry })).toEqual({
    version: 2,
    domain: "brand",
    settings: { value: brand, revision: 3, source: "stored", updatedAt: "2026-09-24T12:00:00.000Z", updatedBy: "0x3333333333333333333333333333333333333333" },
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
