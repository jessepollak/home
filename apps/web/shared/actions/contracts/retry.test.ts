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

  test("accepts a response with an action id", () => {
    expect(parseRetryActionResponse({ version: 1, action: { id: "action-id" } })?.action.id).toBe("action-id");
    for (const value of [{ version: 2, action: { id: "action-id" } }, { version: 1, action: {} },
      { version: 1, action: { id: 1 } }, null, []]) expect(parseRetryActionResponse(value)).toBeNull();
  });
});
