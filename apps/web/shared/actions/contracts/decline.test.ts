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

  test("accepts a versioned response with an action id and rejects malformed responses", () => {
    const response = { version: DECLINE_ACTION_CONTRACT_VERSION, action: { id: "action-id" } };
    expect(parseDeclineActionResponse(response)?.version).toBe(1);
    expect(parseDeclineActionResponse(response)?.action.id).toBe("action-id");
    for (const value of [
      { version: 2, action: { id: "action-id" } },
      { version: 1, action: {} },
      { version: 1, action: { id: 1 } },
      { version: 1, action: [] },
      null,
      [],
      "1",
    ]) {
      expect(parseDeclineActionResponse(value)).toBeNull();
    }
  });
});
