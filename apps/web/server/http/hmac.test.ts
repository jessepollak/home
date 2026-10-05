import { describe, expect, test } from "bun:test";
import { timingSafeEqualBytes } from "./hmac";

describe("timing-safe byte comparison", () => {
  test("accepts equal bytes", () => {
    expect(timingSafeEqualBytes(new Uint8Array([0, 127, 255]), new Uint8Array([0, 127, 255]))).toBe(true);
  });

  test("rejects different bytes of equal length", () => {
    expect(timingSafeEqualBytes(new Uint8Array([0, 127, 255]), new Uint8Array([0, 128, 255]))).toBe(false);
  });

  test.each([
    [[], [1]],
    [[1], []],
    [[1], [1, 2]],
    [[1, 2], [1]],
  ])("rejects different lengths without throwing: %j versus %j", (left, right) => {
    expect(timingSafeEqualBytes(new Uint8Array(left), new Uint8Array(right))).toBe(false);
  });

  test("accepts empty arrays", () => {
    expect(timingSafeEqualBytes(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  test.each([
    [Buffer.from([1, 2]), Buffer.from([1, 2])],
    [Buffer.from([1, 2]), new Uint8Array([1, 2])],
    [new Uint8Array([1, 2]), Buffer.from([1, 2])],
    [new Uint8Array([0, 1, 2, 3]).subarray(1, 3), Buffer.from([1, 2])],
  ])("accepts buffer and typed-array inputs: %j versus %j", (left, right) => {
    expect(timingSafeEqualBytes(left, right)).toBe(true);
  });
});
