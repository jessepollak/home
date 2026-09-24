import { describe, expect, test } from "bun:test";
import {
  buildBalancesSnapshotFixture,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { homeBalancesStatus } from "./home-status";

const cash = {
  usdc: {
    balance: ready("12340000"),
    value: priced("USD", "1234"),
    cashValue: pricedCash("USD", "1234"),
  },
};

function statusFor(snapshot: BalancesSnapshot) {
  return homeBalancesStatus(presentBalances({ status: "ready", snapshot, error: null }));
}

describe("Home header status", () => {
  test("stays hidden while loading and when every balance is complete", () => {
    expect(homeBalancesStatus(presentBalances({ status: "loading", snapshot: null, error: null }))).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({ registry: cash }))).toBeNull();
  });

  test("offers Reload when some balances are unavailable", () => {
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: { ...cash, eth: { balance: unavailableBalance, value: { status: "unavailable" } } },
    }))).toEqual({ message: "Some balances are unavailable", recovery: "reload" });
  });

  test("offers Reload when the balances read fails", () => {
    expect(homeBalancesStatus(presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })))
      .toEqual({ message: "Balances are unavailable", recovery: "reload" });
  });

  test("keeps the country prompt and routes to Account instead of Reload", () => {
    expect(statusFor(buildBalancesSnapshotFixture({ region: "GLOBAL", registry: cash }))).toEqual({
      message: "Choose a country in Account to set how money is shown",
      recovery: "choose-country",
    });
  });
});
