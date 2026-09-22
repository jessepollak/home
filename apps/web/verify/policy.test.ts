import { describe, expect, test } from "bun:test";
import { confirmPolicyRefusal, requestedCaps, resolveVerifyRole, verifyPolicy } from "./policy";

const safe = {
  role: "factory" as const,
  amountUsd: 1,
  balanceUsd: 5,
  runSpendUsd: 0,
  todayFactorySpendUsd: 0,
  clickCapUsd: 1,
  runCapUsd: 2,
};

describe("verification roles and caps", () => {
  test("defaults to operator and accepts only declared roles", () => {
    expect(resolveVerifyRole(undefined)).toBe("operator");
    expect(resolveVerifyRole("factory")).toBe("factory");
    expect(() => resolveVerifyRole("robot")).toThrow("operator or factory");
  });

  test("fixes factory caps and bounds operator caps by the factory daily cap", () => {
    expect(requestedCaps("factory", null, null)).toEqual({ clickCapUsd: 1, runCapUsd: 2 });
    expect(() => requestedCaps("factory", 1.01, 2)).toThrow("Factory --max-usd");
    expect(() => requestedCaps("factory", 1, 2.01)).toThrow("Factory --max-usd-total");
    expect(() => requestedCaps("factory", Number.NaN, 1)).toThrow("positive number");
    expect(() => requestedCaps("factory", 1, Number.NaN)).toThrow("positive number");
    expect(() => requestedCaps("factory", -1, -5)).toThrow("positive number");
    expect(requestedCaps("operator", 1, null)).toEqual({ clickCapUsd: 1, runCapUsd: 1 });
    expect(() => requestedCaps("operator", null, null)).toThrow("operator mode");
    expect(() => requestedCaps("operator", 6, 6)).toThrow("daily cap");
  });

  test("publishes the locked policy numbers", () => {
    expect(verifyPolicy).toEqual({
      factory: { perClickUsd: 1, perRunUsd: 2, perDayUsd: 5 },
    });
  });
});

describe("confirmation refusals", () => {
  test("accepts a fully bounded confirmation", () => {
    expect(confirmPolicyRefusal(safe)).toBeNull();
  });

  test("never refuses on the rendered balance alone", () => {
    expect(confirmPolicyRefusal({ ...safe, balanceUsd: 26.89 })).toBeNull();
  });

  test("refuses unknown balance or amount without any arm state", () => {
    expect(confirmPolicyRefusal({ ...safe, amountUsd: null })).toContain("amount is not knowable");
    expect(confirmPolicyRefusal({ ...safe, balanceUsd: null })).toContain("balance is not knowable");
  });

  test("refuses balance, click, run, and daily cap violations", () => {
    expect(confirmPolicyRefusal({ ...safe, amountUsd: 2, balanceUsd: 1 })).toContain("exceeds the rendered balance");
    expect(confirmPolicyRefusal({ ...safe, amountUsd: 1.01 })).toContain("click cap");
    expect(confirmPolicyRefusal({ ...safe, runSpendUsd: 1.01 })).toContain("run cap");
    expect(confirmPolicyRefusal({ ...safe, todayFactorySpendUsd: 4.01 })).toContain("daily cap");
    expect(confirmPolicyRefusal({ ...safe, role: "operator", todayFactorySpendUsd: 100 })).toBeNull();
  });
});
