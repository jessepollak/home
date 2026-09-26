import { describe, expect, test } from "bun:test";
import { weightedAprWad } from "./math";

describe("weighted borrowing APR", () => {
  test("returns null for empty and zero-weight entries", () => {
    expect(weightedAprWad([])).toBeNull();
    expect(weightedAprWad([{ weight: BigInt(0), aprWad: "100000000000000000" }])).toBeNull();
  });
  test("weights rates by their bigint weights and truncates fractional WAD units", () => {
    expect(weightedAprWad([
      { weight: BigInt(1), aprWad: "10000000000000001" },
      { weight: BigInt(3), aprWad: "20000000000000000" },
      { weight: BigInt(0), aprWad: "900000000000000000" },
    ])).toBe("17500000000000000");
  });
});
