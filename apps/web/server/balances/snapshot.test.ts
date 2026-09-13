import { describe, expect, test } from "bun:test";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { balancesSnapshotFixture, FIXTURE_FETCHED_AT, FIXTURE_OWNER_ADDRESS } from "@/shared/balances/fixtures";
import { assembleBalancesSnapshot } from "./snapshot";
import type { BalancesRead } from "./types";

const read: BalancesRead = {
  block: balancesSnapshotFixture.block,
  holdings: [],
  coverage: balancesSnapshotFixture.coverage,
};

describe("balances snapshot", () => {
  test("assembles a response accepted by the locked contract", () => {
    const snapshot = assembleBalancesSnapshot({ owner: FIXTURE_OWNER_ADDRESS, region: "US", read, holdings: balancesSnapshotFixture.holdings, now: () => new Date(FIXTURE_FETCHED_AT) });
    expect(parseBalancesSnapshot(snapshot, { subject: "fixture", smartAccountAddress: FIXTURE_OWNER_ADDRESS, chainId: 8453 }, "US")).toEqual(snapshot);
  });

  test("catalog value never rescues an unavailable registry total", () => {
    const holdings = balancesSnapshotFixture.holdings.map((holding) => holding.source === "registry"
      ? { ...holding, balance: { status: "unavailable" as const, baseUnits: null }, value: { status: "unavailable" as const }, ...(holding.cashCurrency ? { cashValue: { status: "unavailable" as const } } : {}), ...(holding.kind === "vault-share" ? { underlyingBalance: { status: "unavailable" as const, baseUnits: null } } : {}) }
      : holding);
    const snapshot = assembleBalancesSnapshot({ owner: FIXTURE_OWNER_ADDRESS, region: "US", read: { ...read, coverage: { ...read.coverage, registry: "partial" } }, holdings });
    expect(snapshot.total).toEqual({ status: "unavailable", value: null, currency: "USD" });
  });
});
