import { describe, expect, test } from "bun:test";
import { getBalancesUniverse } from "./universe";

describe("balances universe", () => {
  test("lists cash assets first", async () => {
    const result = await getBalancesUniverse();

    expect(result.entries.slice(0, 3).map(({ id }) => id)).toEqual([
      "usdc",
      "eurc",
      "idrx",
    ]);
  });
});
