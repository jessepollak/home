import { describe, expect, test } from "bun:test";
import { presentHomeBalanceMark, presentHomeBalanceRow } from "./home-balance-row";

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

describe("presentHomeBalanceMark", () => {
  test("passes presentation cash currencies and their symbols for flags", () => {
    expect(
      presentHomeBalanceMark({
        id: "cash:usd",
        group: "cash",
        name: "US dollar",
        displayBalance: "$25.00",
        currencyCode: "USD",
      }),
    ).toEqual({ currency: "USD", symbol: "$" });

    expect(
      presentHomeBalanceMark({
        id: "cash:idr",
        group: "cash",
        name: "Indonesian rupiah",
        displayBalance: "Rp 2,500.00",
        currencyCode: "IDR",
      }),
    ).toEqual({ currency: "IDR", symbol: "Rp" });

    expect(
      presentHomeBalanceMark({
        id: "cash:unknown",
        group: "cash",
        name: "Local currency",
        displayBalance: "—",
        currencyCode: "LCL",
      }),
    ).toEqual({ currency: "LCL", symbol: "LCL" });
  });

  test("keeps leftover fiat asset rows eligible for flags and never flags crypto", () => {
    expect(
      presentHomeBalanceMark({
        id: "asset:eurc",
        group: "asset",
        name: "Euro",
        detail: "EURC",
        displayBalance: "€10.00",
        currencyCode: "EUR",
      }),
    ).toEqual({ currency: "EUR", symbol: "€" });

    expect(
      presentHomeBalanceMark({
        id: "asset:eth",
        group: "asset",
        name: "Ethereum",
        detail: "ETH",
        displayBalance: "0.5 ETH",
      }),
    ).toEqual({ currency: null, symbol: "ETH" });

    expect(
      presentHomeBalanceMark({
        id: "asset:mislabelled",
        group: "asset",
        name: "Ethereum",
        detail: "ETH",
        displayBalance: "0.5 ETH",
        currencyCode: "ETH",
      }),
    ).toEqual({ currency: null, symbol: "ETH" });
  });
});
