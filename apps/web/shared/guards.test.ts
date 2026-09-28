import { describe, expect, test } from "bun:test";
import { isRecord, isUnknownArray } from "./guards";

describe("shared guards", () => {
  test("isRecord accepts objects but excludes null, arrays, and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ value: 1 })).toBe(true);
    for (const value of [null, [], [1], "text", 1, true, undefined]) {
      expect(isRecord(value)).toBe(false);
    }
  });

  test("isUnknownArray accepts arrays but excludes array-like objects, strings, and null", () => {
    expect(isUnknownArray([])).toBe(true);
    expect(isUnknownArray([1, "text"])).toBe(true);
    for (const value of [{ 0: "value", length: 1 }, "text", null, {}, 1, undefined]) {
      expect(isUnknownArray(value)).toBe(false);
    }
  });
});
