import { describe, expect, test } from "bun:test";
import { RETRY_ACTION_CONTRACT_VERSION, parseRetryActionRequest, parseRetryActionResponse } from "./retry";

describe("retry action contract", () => {
  test("accepts only an exact versioned request with a bounded positive attempt", () => {
    expect(parseRetryActionRequest({ version: RETRY_ACTION_CONTRACT_VERSION, attempt: 1 })).toEqual({ version: 1, attempt: 1 });
    expect(parseRetryActionRequest({ version: 1, attempt: 1000 })).toEqual({ version: 1, attempt: 1000 });
    for (const value of [{ version: 1, attempt: 0 }, { version: 1, attempt: 1001 },
      { version: 1, attempt: 1.5 }, { version: 1, attempt: Number.MAX_SAFE_INTEGER + 1 },
      { version: 1, attempt: "1" }, { version: 1, attempt: 1, extra: true },
      { version: 1 }, { version: 2, attempt: 1 }, null, []]) {
      expect(parseRetryActionRequest(value)).toBeNull();
    }
  });

  test("accepts a complete presented action and rejects malformed summaries", () => {
    const action = {
      id: "action-id", provider: "cdp-embedded", kind: "send", status: "pending",
      summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-10-01T12:03:00.000Z" },
      createdAt: "2026-10-01T12:00:00.000Z", confirmedAt: "2026-10-01T12:00:00.000Z",
      owner: { subject: "owner", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
    };
    const response = { version: RETRY_ACTION_CONTRACT_VERSION, action };
    expect(parseRetryActionResponse(response)?.action.id).toBe("action-id");
    for (const value of [{ version: 2, action }, { version: 1, action: {} },
      { version: 1, action: { id: 1 } },
      { ...response, action: { ...action, summary: { ...action.summary, warnings: [1] } } },
      { ...response, action: { ...action, summary: { ...action.summary, title: undefined } } },
      null, []]) expect(parseRetryActionResponse(value)).toBeNull();
  });
});
