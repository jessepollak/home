import { describe, expect, test } from "bun:test";
import {
  DECLINE_ACTION_CONTRACT_VERSION,
  parseDeclineActionRequest,
  parseDeclineActionResponse,
} from "./decline";

describe("decline action contract", () => {
  test("accepts only the exact versioned request", () => {
    expect(parseDeclineActionRequest({ version: DECLINE_ACTION_CONTRACT_VERSION, attempt: 0 })).toEqual({ version: 1, attempt: 0 });
    expect(parseDeclineActionRequest({ version: 1, attempt: 1000 })).toEqual({ version: 1, attempt: 1000 });
    for (const value of [{}, { version: 2, attempt: 0 }, { version: 1 }, { version: 1, attempt: -1 },
      { version: 1, attempt: 1001 }, { version: 1, attempt: 0.5 }, { version: 1, attempt: "0" },
      { version: 1, attempt: Number.MAX_SAFE_INTEGER + 1 }, { version: 1, attempt: 0, extra: true }, null, [], "1"]) {
      expect(parseDeclineActionRequest(value)).toBeNull();
    }
  });

  test("accepts a complete presented action and rejects malformed responses", () => {
    const action = {
      id: "action-id", provider: "cdp-embedded", kind: "send", status: "pending",
      summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-10-01T12:03:00.000Z" },
      createdAt: "2026-10-01T12:00:00.000Z", confirmedAt: "2026-10-01T12:00:00.000Z",
      owner: { subject: "owner", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
    };
    const response = { version: DECLINE_ACTION_CONTRACT_VERSION, action };
    expect(parseDeclineActionResponse(response)?.version).toBe(1);
    expect(parseDeclineActionResponse(response)?.action.id).toBe("action-id");
    for (const value of [
      { version: 2, action: { id: "action-id" } },
      { version: 1, action: {} },
      { version: 1, action: { id: 1 } },
      { version: 1, action: [] },
      { ...response, action: { ...action, summary: { ...action.summary, warnings: [1] } } },
      { ...response, action: { ...action, summary: { ...action.summary, title: undefined } } },
      null,
      [],
      "1",
    ]) {
      expect(parseDeclineActionResponse(value)).toBeNull();
    }
  });
});
