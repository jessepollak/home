import { describe, expect, test } from "bun:test";
import {
  buildBalancesSnapshotFixture,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { deriveAssetMarkResolution, deriveSendAvailability } from "./send-availability";

describe("deriveAssetMarkResolution", () => {
  test("maps every validated holding, including zero and unavailable balances", () => {
    const fixture = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0") },
        cbbtc: { balance: unavailableBalance },
      },
    });
    const snapshot = {
      ...fixture,
      holdings: fixture.holdings.map((holding) => holding.id === "cbbtc"
        ? { ...holding, imageUrl: "https://assets.example.invalid/cbbtc.png" }
        : holding),
    };

    const resolution = deriveAssetMarkResolution(snapshot);
    const usdc = snapshot.holdings.find((holding) => holding.id === "usdc")!;
    const cbbtc = snapshot.holdings.find((holding) => holding.id === "cbbtc")!;
    expect(resolution.images?.[usdc.key]).toBeNull();
    expect(resolution.images?.[cbbtc.key]).toBe("https://assets.example.invalid/cbbtc.png");
    expect(resolution.pending).toBe(false);
    expect(deriveAssetMarkResolution(null, true)).toEqual({ images: {}, pending: true });
  });
});

describe("deriveSendAvailability", () => {
  test("maps a priced holding's unit value and leaves an unpriced holding without a price", () => {
    const fixture = buildBalancesSnapshotFixture({
      registry: {
        cbbtc: { balance: ready("100000") },
        eth: { balance: ready("10000000000000000") },
      },
    });
    const snapshot = {
      ...fixture,
      holdings: fixture.holdings.map((holding) => holding.id === "cbbtc"
        ? { ...holding, unitValue: { currency: "USD" as const, amount: { atoms: "109390", scale: 0 } } }
        : holding),
    };

    const availability = deriveSendAvailability(snapshot);
    expect(availability.find((entry) => entry.id === "cbbtc")?.price).toEqual({
      currency: "USD", perUnit: { atoms: "109390", scale: 0 },
    });
    expect(availability.find((entry) => entry.id === "eth")?.price).toBeNull();
  });

  test("does not carry snapshot freshness into Send presentation data", () => {
    const snapshot = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:00.000Z",
      registry: { usdc: { balance: ready("12340000") } },
    });
    const asset = deriveSendAvailability({ ...snapshot, stale: true })
      .find((entry) => entry.id === "usdc");

    expect(asset).toBeDefined();
    expect("balanceAgeLabel" in asset!).toBe(false);
  });
});
