import { describe, expect, test } from "bun:test";
import { getBalancesUniverse, registryEntries } from "./universe";

describe("balances universe", () => {
  test("contains only configured registry entries in stable cash-first order", async () => {
    const result = await getBalancesUniverse();

    expect(result.entries).toEqual(registryEntries());
    expect(result.entries.slice(0, 3).map(({ id }) => id)).toEqual([
      "usdc",
      "eurc",
      "idrx",
    ]);
    expect(result.entries.every(({ source }) => source === "registry"))
      .toBeTrue();
  });
});
