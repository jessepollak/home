import { describe, expect, test } from "bun:test";
import {
  FIXTURE_CATALOG,
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { deriveSendAvailability } from "./send-availability";

const cases: Array<{
  name: string;
  snapshot: ReturnType<typeof buildBalancesSnapshotFixture>;
  expected: string[][];
}> = [
  {
    name: "returns positive ready registry assets in snapshot order",
    snapshot: buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("12340000") },
        cbbtc: { balance: ready("100000") },
        eth: { balance: ready("10000000000000000") },
      },
    }),
    expected: [
      ["eth", "10000000000000000"],
      ["usdc", "12340000"],
      ["cbbtc", "100000"],
    ],
  },
  {
    name: "excludes zero, unavailable, vault shares, and catalog assets",
    snapshot: buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0") },
        cbbtc: { balance: unavailableBalance },
        "morpho-steakhouse-usdc": { balance: ready("1"), underlyingBalance: ready("1") },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "1"))],
    }),
    expected: [],
  },
];

describe("deriveSendAvailability", () => {
  for (const entry of cases) {
    test(entry.name, () => {
      const availability = deriveSendAvailability(entry.snapshot);
      expect(availability.map((asset) => [asset.id, asset.balanceBaseUnits])).toEqual(entry.expected);
    });
  }

  test("carries a stale snapshot age for Send max labels", () => {
    const snapshot = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:00.000Z",
      registry: { usdc: { balance: ready("12340000") } },
    });
    const availability = deriveSendAvailability(
      { ...snapshot, stale: true },
      Date.parse("2026-09-13T12:03:00.000Z"),
    );

    expect(availability.find((asset) => asset.id === "usdc")?.balanceAgeLabel).toBe(
      "Updated 3 min ago",
    );
  });
});
