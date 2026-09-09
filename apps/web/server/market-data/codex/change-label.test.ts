import { describe, expect, test } from "bun:test";
import { formatChangeLabel } from "./change-label";

describe("formatChangeLabel", () => {
  test("formats Codex decimal ratios as signed Δ% and omits missing or zero change", () => {
    expect(formatChangeLabel(0.05)).toBe("+5.00%");
    expect(formatChangeLabel("0.05")).toBe("+5.00%");
    expect(formatChangeLabel("-0.0125")).toBe("-1.25%");
    expect(formatChangeLabel("-0.00667")).toBe("-0.67%");
    expect(formatChangeLabel(0)).toBeUndefined();
    expect(formatChangeLabel("0")).toBeUndefined();
    expect(formatChangeLabel("0.00")).toBeUndefined();
    expect(formatChangeLabel(null)).toBeUndefined();
    expect(formatChangeLabel(undefined)).toBeUndefined();
    expect(formatChangeLabel("")).toBeUndefined();
    expect(formatChangeLabel("nope")).toBeUndefined();
    expect(formatChangeLabel(Number.NaN)).toBeUndefined();
    expect(formatChangeLabel(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
