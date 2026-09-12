import { describe, expect, test } from "bun:test";
import { isRecordedOperationsAvailability } from "./types";

describe("activity secondary-source availability contract", () => {
  test("accepts only the explicit available and unavailable markers", () => {
    expect(isRecordedOperationsAvailability("available")).toBe(true);
    expect(isRecordedOperationsAvailability("unavailable")).toBe(true);
    expect(isRecordedOperationsAvailability("failed")).toBe(false);
    expect(isRecordedOperationsAvailability(null)).toBe(false);
  });
});
