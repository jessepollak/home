import { describe, expect, test } from "bun:test";
import { observeSafely } from "./log";

describe("observeSafely", () => {
  test("calls the report exactly once and returns undefined", () => {
    let calls = 0;
    expect(observeSafely(() => { calls += 1; })).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("swallows a synchronous throw", () => {
    expect(() => observeSafely(() => { throw new Error("sink failed"); })).not.toThrow();
  });

  test("consumes a rejected report without an unhandled rejection", async () => {
    expect(observeSafely(() => Promise.reject(new Error("sink failed")))).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
  });

  test("accepts a resolved report", async () => {
    expect(observeSafely(() => Promise.resolve("observed"))).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
  });
});
