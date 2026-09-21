import { describe, expect, test } from "bun:test";
import { confirmPolicyRefusal, requestedCaps, resolveVerifyRole, verifyPolicy } from "./policy";

const safe = {
  role: "factory" as const,
  armed: true,
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

  test("fixes factory caps and bounds operator caps by the balance ceiling", () => {
    expect(requestedCaps("factory", null, null)).toEqual({ clickCapUsd: 1, runCapUsd: 2 });
    expect(() => requestedCaps("factory", 1.01, 2)).toThrow("Factory --max-usd");
    expect(() => requestedCaps("factory", 1, 2.01)).toThrow("Factory --max-usd-total");
    expect(requestedCaps("operator", 1, null)).toEqual({ clickCapUsd: 1, runCapUsd: 1 });
    expect(() => requestedCaps("operator", null, null)).toThrow("operator mode");
    expect(() => requestedCaps("operator", 6, 6)).toThrow("ceiling");
  });

  test("publishes the locked policy numbers", () => {
    expect(verifyPolicy).toEqual({
      factory: { perClickUsd: 1, perRunUsd: 2, perDayUsd: 5 },
      balanceCeilingUsd: 5,
      cleanRunsToArm: 3,
    });
  });
});

describe("confirmation refusals", () => {
  test("accepts a fully bounded confirmation", () => {
    expect(confirmPolicyRefusal(safe)).toBeNull();
  });

  test("refuses a disarmed surface and unknown balance or amount", () => {
    expect(confirmPolicyRefusal({ ...safe, armed: false })).toContain("disarmed");
    expect(confirmPolicyRefusal({ ...safe, amountUsd: null })).toContain("amount is not knowable");
    expect(confirmPolicyRefusal({ ...safe, balanceUsd: null })).toContain("balance is not knowable");
  });

  test("refuses balance, ceiling, click, run, and daily cap violations", () => {
    expect(confirmPolicyRefusal({ ...safe, amountUsd: 2, balanceUsd: 1 })).toContain("exceeds the rendered balance");
    expect(confirmPolicyRefusal({ ...safe, balanceUsd: 5.01 })).toContain("ceiling");
    expect(confirmPolicyRefusal({ ...safe, amountUsd: 1.01 })).toContain("click cap");
    expect(confirmPolicyRefusal({ ...safe, runSpendUsd: 1.01 })).toContain("run cap");
    expect(confirmPolicyRefusal({ ...safe, todayFactorySpendUsd: 4.01 })).toContain("daily cap");
    expect(confirmPolicyRefusal({ ...safe, role: "operator", todayFactorySpendUsd: 100 })).toBeNull();
  });
});
