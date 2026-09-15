import { describe, expect, test } from "bun:test";
import { parseConfirmActionResponse } from "./confirm";

const calls = [{
  to: "0x1111111111111111111111111111111111111111" as const,
  data: "0x1234" as const,
  value: "0",
}];

describe("confirm action response parser", () => {
  test("accepts an absent or valid optional decimal batch gas limit", () => {
    expect(parseConfirmActionResponse({ calls })).toEqual({ calls });
    expect(parseConfirmActionResponse({ calls, batchGasLimit: "2000000" })).toEqual({
      calls,
      batchGasLimit: "2000000",
    });
  });

  test("rejects malformed, zero, and out-of-range batch gas limits", () => {
    for (const batchGasLimit of ["0", "01", "0x10", "1.5", "2000001", 100000]) {
      expect(parseConfirmActionResponse({ calls, batchGasLimit })).toBeNull();
    }
  });
});
