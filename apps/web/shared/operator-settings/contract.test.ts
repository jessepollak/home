import { expect, test } from "bun:test";
import { parsePutSettingsRequest, parseSupportSettings } from "./contract";

const operator = "0x1111111111111111111111111111111111111111";

test("put settings requests require a version, a revision and a valid operator address", () => {
  expect<unknown>(parsePutSettingsRequest({ version: 2, expectedRevision: 0, value: { email: null, url: null }, operator })).toEqual({ version: 2, expectedRevision: 0, value: { email: null, url: null }, operator });
  for (const value of [
    { version: 1, expectedRevision: 0, value: {}, operator },
    { version: 1, expectedRevision: 0, value: {} },
    { version: 2, expectedRevision: 0, value: {} },
    { version: 3, expectedRevision: 0, value: {}, operator },
    { version: 2, expectedRevision: -1, value: {}, operator },
    { version: 2, expectedRevision: 0, value: {}, operator: "0x1234" },
    { version: 2, expectedRevision: 0, operator },
  ]) {
    expect(parsePutSettingsRequest(value)).toBeNull();
  }
});

test("support settings shown to customers reject malformed email and unsafe urls", () => {
  expect(parseSupportSettings({ email: null, url: null })).toEqual({ email: null, url: null });
  for (const value of [
    { email: "not-email", url: null },
    { email: " user@example.com", url: null },
    { email: null, url: "http://example.com" },
    { email: null, url: "https://user:pass@example.com" },
  ]) {
    expect(parseSupportSettings(value)).toBeNull();
  }
});
