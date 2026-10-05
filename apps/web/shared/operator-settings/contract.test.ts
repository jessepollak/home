import { expect, test } from "bun:test";
import { parseAllSettingsResponse, parseAuditListResponse, parsePutSettingsRequest, parseSettingsResponse, parseSupportSettings } from "./contract";

const operator = "0x1111111111111111111111111111111111111111";
const support = { value: { email: null, url: null }, revision: 0, source: "default", updatedAt: null, updatedBy: null };

test("put settings requests require a version, a revision and a valid operator address", () => {
  expect<unknown>(parsePutSettingsRequest({ version: 1, expectedRevision: 0, value: { email: null, url: null }, operator })).toEqual({ version: 1, expectedRevision: 0, value: { email: null, url: null }, operator });
  for (const value of [
    { version: 2, expectedRevision: 0, value: {}, operator },
    { version: 1, expectedRevision: -1, value: {}, operator },
    { version: 1, expectedRevision: 0, value: {}, operator: "0x1234" },
    { version: 1, expectedRevision: 0, operator },
  ]) {
    expect(parsePutSettingsRequest(value)).toBeNull();
  }
});

test("support settings reject malformed email and url values", () => {
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

test("settings and audit responses require the contract version", () => {
  expect<unknown>(parseSettingsResponse({ version: 1, domain: "support", settings: support })).toEqual({ version: 1, domain: "support", settings: support });
  expect(parseSettingsResponse({ version: 2, domain: "support", settings: support })).toBeNull();
  expect<unknown>(parseAllSettingsResponse({ version: 1, domains: [{ domain: "support", settings: support }] })).toEqual({ version: 1, domains: [{ domain: "support", settings: support }] });
  expect(parseAllSettingsResponse({ version: 2, domains: [] })).toBeNull();
  expect(parseAuditListResponse({ version: 1, entries: [], nextCursor: null })).toEqual({ version: 1, entries: [], nextCursor: null });
  expect(parseAuditListResponse({ version: 2, entries: [], nextCursor: null })).toBeNull();
});
