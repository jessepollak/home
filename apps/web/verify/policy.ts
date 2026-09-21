export const verifyPolicy = {
  factory: {
    perClickUsd: 1,
    perRunUsd: 2,
    perDayUsd: 5,
  },
  balanceCeilingUsd: 5,
  cleanRunsToArm: 3,
} as const;

export type VerifyRole = "operator" | "factory";

export type ConfirmPolicyInput = {
  role: VerifyRole;
  armed: boolean;
  amountUsd: number | null;
  balanceUsd: number | null;
  runSpendUsd: number;
  todayFactorySpendUsd: number;
  clickCapUsd: number;
  runCapUsd: number;
};

export function resolveVerifyRole(value: string | undefined): VerifyRole {
  if (value === undefined || value.trim() === "") return "operator";
  if (value === "operator" || value === "factory") return value;
  throw new Error("HOME_VERIFY_ROLE must be operator or factory.");
}

export function requestedCaps(
  role: VerifyRole,
  requestedClick: number | null,
  requestedRun: number | null,
): { clickCapUsd: number; runCapUsd: number } {
  if (role === "factory") {
    if (requestedClick !== null && requestedClick > verifyPolicy.factory.perClickUsd) {
      throw new Error(`Factory --max-usd cannot exceed $${verifyPolicy.factory.perClickUsd.toFixed(2)}.`);
    }
    if (requestedRun !== null && requestedRun > verifyPolicy.factory.perRunUsd) {
      throw new Error(`Factory --max-usd-total cannot exceed $${verifyPolicy.factory.perRunUsd.toFixed(2)}.`);
    }
    return {
      clickCapUsd: requestedClick ?? verifyPolicy.factory.perClickUsd,
      runCapUsd: requestedRun ?? verifyPolicy.factory.perRunUsd,
    };
  }
  if (requestedClick === null || !Number.isFinite(requestedClick) || requestedClick <= 0) {
    throw new Error("Live confirmation requires --max-usd <positive-number> with no default in operator mode.");
  }
  const runCap = requestedRun ?? requestedClick;
  if (!Number.isFinite(runCap) || runCap <= 0) throw new Error("--max-usd-total must be a positive number.");
  if (requestedClick > verifyPolicy.balanceCeilingUsd || runCap > verifyPolicy.balanceCeilingUsd) {
    throw new Error(`Operator confirmation caps cannot exceed the $${verifyPolicy.balanceCeilingUsd.toFixed(2)} bot-account ceiling.`);
  }
  return { clickCapUsd: requestedClick, runCapUsd: runCap };
}

export function confirmPolicyRefusal(input: ConfirmPolicyInput): string | null {
  if (!input.armed) return "Rung 3 is disarmed for this surface.";
  if (input.amountUsd === null || !Number.isFinite(input.amountUsd) || input.amountUsd < 0) {
    return "The confirmation amount is not knowable.";
  }
  if (input.balanceUsd === null || !Number.isFinite(input.balanceUsd) || input.balanceUsd < 0) {
    return "The rendered account balance is not knowable; confirmation was refused.";
  }
  if (input.balanceUsd > verifyPolicy.balanceCeilingUsd) {
    return `The rendered account balance exceeds the $${verifyPolicy.balanceCeilingUsd.toFixed(2)} bot-account ceiling.`;
  }
  if (input.amountUsd > input.balanceUsd) {
    return `The confirmation amount $${input.amountUsd.toFixed(2)} exceeds the rendered balance $${input.balanceUsd.toFixed(2)}.`;
  }
  if (input.amountUsd > input.clickCapUsd) {
    return `The confirmation amount $${input.amountUsd.toFixed(2)} exceeds the $${input.clickCapUsd.toFixed(2)} click cap.`;
  }
  if (input.runSpendUsd + input.amountUsd > input.runCapUsd) {
    return `The run spend would exceed the $${input.runCapUsd.toFixed(2)} run cap.`;
  }
  if (input.role === "factory" && input.todayFactorySpendUsd + input.amountUsd > verifyPolicy.factory.perDayUsd) {
    return `Today's factory spend would exceed the $${verifyPolicy.factory.perDayUsd.toFixed(2)} daily cap.`;
  }
  return null;
}
