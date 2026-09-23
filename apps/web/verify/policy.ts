export const verifyPolicy = { perSessionConfirms: 1, perDayConfirms: 5 } as const;

export type VerifyRole = "operator" | "factory";

export function resolveVerifyRole(value: string | undefined): VerifyRole {
  if (value === undefined || value.trim() === "") return "operator";
  if (value === "operator" || value === "factory") return value;
  throw new Error("HOME_VERIFY_ROLE must be operator or factory.");
}

export function requestedConfirmLimit(value: string | undefined): number {
  if (value === undefined) return verifyPolicy.perSessionConfirms;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > verifyPolicy.perDayConfirms) {
    throw new Error(`--max-confirms must be an integer from 1 to ${verifyPolicy.perDayConfirms}.`);
  }
  return count;
}

export function confirmCountRefusal(sessionCount: number, dayCount: number, sessionLimit: number): string | null {
  if (sessionCount >= sessionLimit) return `The ${sessionLimit}-confirm session limit has been reached.`;
  if (dayCount >= verifyPolicy.perDayConfirms) return `The ${verifyPolicy.perDayConfirms}-confirm daily limit has been reached.`;
  return null;
}
