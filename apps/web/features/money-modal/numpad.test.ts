import { describe, expect, test } from "bun:test";
import { applyNumpadKey, isPositiveDecimalAmount } from "./numpad";

describe("applyNumpadKey", () => {
  test("builds a decimal amount without leading-zero piles", () => {
    expect(applyNumpadKey("", "2", 6)).toBe("2");
    expect(applyNumpadKey("2", "5", 6)).toBe("25");
    expect(applyNumpadKey("25", ".", 6)).toBe("25.");
    expect(applyNumpadKey("25.", "5", 6)).toBe("25.5");
    expect(applyNumpadKey("25.5", "backspace", 6)).toBe("25.");
    expect(applyNumpadKey("0", "5", 6)).toBe("5");
    expect(applyNumpadKey("", ".", 6)).toBe("0.");
  });

  test("respects max decimals and ignores a second point", () => {
    expect(applyNumpadKey("1.234567", "8", 6)).toBe("1.234567");
    expect(applyNumpadKey("1.2", ".", 6)).toBe("1.2");
    expect(applyNumpadKey("1", ".", 0)).toBe("1");
  });
});

describe("isPositiveDecimalAmount", () => {
  test("gates Continue on a positive decimal", () => {
    expect(isPositiveDecimalAmount("")).toBe(false);
    expect(isPositiveDecimalAmount("0")).toBe(false);
    expect(isPositiveDecimalAmount("0.00")).toBe(false);
    expect(isPositiveDecimalAmount("25.")).toBe(true);
    expect(isPositiveDecimalAmount("0.01")).toBe(true);
    expect(isPositiveDecimalAmount("25")).toBe(true);
  });
});
