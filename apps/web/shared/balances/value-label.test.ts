import { describe, expect, test } from "bun:test";
import type { HoldingValue } from "./types";
import { holdingValueContext } from "./value-label";

const priced = { status: "priced", currency: "USD", amount: { atoms: "17960", scale: 2 }, asOf: "2026-09-25T20:00:00.000Z" } as const;

describe("holding value context", () => {
  const cases: Array<[string, HoldingValue, string | undefined]> = [
    ["priced crypto", priced, undefined],
    ["open stock reference", { ...priced, reference: { kind: "tokenized-equity", session: "open" } }, undefined],
    ["closed stock reference", { ...priced, reference: { kind: "tokenized-equity", session: "closed" } }, "Last close"],
    ["paused", { status: "unpriced", reason: "price-paused" }, "Paused"],
    ["stale", { status: "unpriced", reason: "price-stale" }, "Price delayed"],
    ["price unavailable", { status: "unpriced", reason: "price-unavailable" }, "Value unavailable"],
    ["removed", { status: "unpriced", reason: "asset-removed" }, "No longer listed"],
    ["fx unavailable", { status: "unpriced", reason: "fx-unavailable" }, "Value unavailable"],
    ["value unavailable", { status: "unavailable" }, "Value unavailable"],
  ];
  for (const [name, value, expected] of cases) {
    test(`${name} → ${expected ?? "no context"}`, () => {
      expect(holdingValueContext(value)).toBe(expected);
    });
  }
});
