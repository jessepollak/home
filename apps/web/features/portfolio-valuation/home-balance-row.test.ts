import { describe, expect, test } from "bun:test";
import { presentHomeBalanceRow } from "./home-balance-row";

describe("presentHomeBalanceRow", () => {
  test("shows an unpriced cash quantity without appending its token ticker", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:local",
        group: "cash",
        name: "Local currency",
        displayBalance: "2,500.00 LCLX",
        currencyCode: "LCL",
      }),
    ).toEqual({
      visualBalance: "2,500.00",
      accessibleBalance: "2,500.00 LCLX",
      tone: "default",
    });
  });

  test("repairs the muted tone from a legacy cached unpriced cash row", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:cached-local",
        group: "cash",
        name: "Local currency",
        displayBalance: "0.00 LCLX",
        currencyCode: "LCL",
        tone: "muted",
      }),
    ).toEqual({
      visualBalance: "0.00",
      accessibleBalance: "0.00 LCLX",
      tone: "default",
    });
  });

  test("does not alter priced, unknown, asset, or failed-read values", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:priced",
        group: "cash",
        name: "US dollar",
        displayBalance: "$25.00",
        currencyCode: "USD",
      }),
    ).toEqual({ visualBalance: "$25.00", tone: undefined });

    expect(
      presentHomeBalanceRow({
        id: "cash:unknown",
        group: "cash",
        name: "Local currency",
        displayBalance: "—",
        currencyCode: "LCL",
        tone: "muted",
      }),
    ).toEqual({ visualBalance: "—", tone: "muted" });

    expect(
      presentHomeBalanceRow({
        id: "asset:token",
        group: "asset",
        name: "Token",
        displayBalance: "25.00 TKN",
      }),
    ).toEqual({ visualBalance: "25.00 TKN", tone: undefined });

    expect(
      presentHomeBalanceRow({
        id: "cash:failed",
        group: "cash",
        name: "Local currency",
        displayBalance: "Unavailable",
        currencyCode: "LCL",
        tone: "error",
      }),
    ).toEqual({ visualBalance: "Unavailable", tone: "error" });
  });
});
