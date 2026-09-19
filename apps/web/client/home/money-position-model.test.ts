import { describe, expect, test } from "bun:test";
import type { MoneyPositionInput } from "./money-position-model";
import {
  moneyPositionKindTotal,
  moneyPositionStatusMessage,
  summarizeMoneyPosition,
} from "./money-position-model";

function input(overrides: Partial<MoneyPositionInput> = {}): MoneyPositionInput {
  return {
    currency: "USD",
    regionId: "US",
    slices: [],
    debt: {
      label: "Borrowed",
      detail: "USDC debt",
      amountMinor: "0",
      status: "ready",
    },
    ...overrides,
  };
}

describe("money position presentation model", () => {
  test("keeps net position unchanged when borrowed proceeds add equal cash and debt", () => {
    const before = summarizeMoneyPosition(input({
      slices: [{
        id: "cash",
        kind: "cash",
        label: "Cash",
        detail: "Available to use",
        amountMinor: "100000",
        status: "ready",
      }],
    }));
    const after = summarizeMoneyPosition(input({
      slices: [{
        id: "cash",
        kind: "cash",
        label: "Cash",
        detail: "Available to use",
        amountMinor: "175000",
        status: "ready",
      }],
      debt: {
        label: "Borrowed",
        detail: "USDC debt",
        amountMinor: "75000",
        status: "ready",
      },
    }));

    expect(before.netPositionMinor).toBe(BigInt(100000));
    expect(after.assetsMinor).toBe(BigInt(175000));
    expect(after.debtMinor).toBe(BigInt(75000));
    expect(after.netPositionMinor).toBe(before.netPositionMinor);
  });

  test("counts locked collateral once without making it spendable", () => {
    const summary = summarizeMoneyPosition(input({
      slices: [
        {
          id: "cash",
          kind: "cash",
          label: "Cash",
          detail: "Available to use",
          amountMinor: "25000",
          status: "ready",
        },
        {
          id: "collateral",
          kind: "collateral",
          label: "Bitcoin collateral",
          detail: "Locked",
          amountMinor: "80000",
          status: "ready",
        },
      ],
    }));

    expect(summary.assetsMinor).toBe(BigInt(105000));
    expect(summary.netPositionMinor).toBe(BigInt(105000));
    expect(summary.spendableMinor).toBe(BigInt(25000));
  });

  test("withholds a headline total and names missing slices", () => {
    const summary = summarizeMoneyPosition(input({
      slices: [
        {
          id: "cash",
          kind: "cash",
          label: "Cash",
          detail: "Available to use",
          amountMinor: "25000",
          status: "ready",
        },
        {
          id: "invested",
          kind: "invested",
          label: "Invested",
          detail: "Market value",
          amountMinor: null,
          status: "unavailable",
        },
      ],
    }));

    expect(summary.status).toBe("partial");
    expect(summary.knownAssetsMinor).toBe(BigInt(25000));
    expect(summary.assetsMinor).toBeNull();
    expect(summary.netPositionMinor).toBeNull();
    expect(summary.missingLabels).toEqual(["Invested"]);
    expect(moneyPositionStatusMessage(summary)).toContain("Missing: Invested");
  });

  test("does not silently treat unavailable debt as zero", () => {
    const summary = summarizeMoneyPosition(input({
      slices: [{
        id: "cash",
        kind: "cash",
        label: "Cash",
        detail: "Available to use",
        amountMinor: "25000",
        status: "ready",
      }],
      debt: {
        label: "Borrowed",
        detail: "USDC debt",
        amountMinor: null,
        status: "unavailable",
      },
    }));

    expect(summary.assetsMinor).toBeNull();
    expect(summary.debtMinor).toBeNull();
    expect(summary.netPositionMinor).toBeNull();
    expect(summary.missingLabels).toContain("Borrowed");
  });

  test("withholds a product subtotal when one matching slice is unavailable", () => {
    const position = input({
      slices: [
        {
          id: "saved-ready",
          kind: "saved",
          label: "Saved",
          detail: "Verified vault",
          amountMinor: "25000",
          status: "ready",
        },
        {
          id: "saved-missing",
          kind: "saved",
          label: "Other saved position",
          detail: "Unavailable vault",
          amountMinor: null,
          status: "unavailable",
        },
      ],
    });

    expect(moneyPositionKindTotal(position, "saved")).toBeNull();
  });

  test("rejects decimal or negative minor-unit inputs", () => {
    expect(() => summarizeMoneyPosition(input({
      slices: [{
        id: "cash",
        kind: "cash",
        label: "Cash",
        detail: "Available to use",
        amountMinor: "1.5",
        status: "ready",
      }],
    }))).toThrow(TypeError);
  });
});
