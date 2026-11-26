import { expect, test } from "bun:test";
import { parseAuditListResponse, parsePutSettingsRequest, parseSupportSettings } from "./contract";

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

test("reward decision audit responses parse both actions with reward targets and before/after evidence", () => {
  for (const action of ["growth.reward.approve", "growth.reward.reject"] as const) {
    const entry = { id: "1", occurredAt: "2026-10-01T00:00:00Z", actor: operator, action,
      target: { kind: "reward", id: "00000000-0000-4000-8000-000000000001" },
      before: { state: "qualified" }, after: { state: action === "growth.reward.approve" ? "approved" : "rejected", riskSignals: [], ...(action === "growth.reward.approve" ? { reservedAtoms: "5000000" } : { reason: "Not eligible" }) } };
    const response = (value: unknown) => ({ version: 2, entries: [value], nextCursor: null });
    expect<unknown>(parseAuditListResponse(response(entry))?.entries[0]).toEqual(entry);
    for (const patch of [{ target: { kind: "settings", id: "growth" } }, { action: "growth.reward.pay" }, { actor: "0x1234" }]) {
      expect(parseAuditListResponse(response({ ...entry, ...patch }))).toBeNull();
    }
    const { before: _before, ...missingBefore } = entry;
    const { after: _after, ...missingAfter } = entry;
    expect(parseAuditListResponse(response(missingBefore))).toBeNull();
    expect(parseAuditListResponse(response(missingAfter))).toBeNull();
  }
});
