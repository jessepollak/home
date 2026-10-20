import { isRecord } from "@/shared/guards";

export const ACCOUNT_DELETED_ERROR_CODE = "ACCOUNT_DELETED" as const;
export const AUTH_BOUNDARY_ERROR_CODES = [
  "UNAUTHENTICATED", "AUTH_UNAVAILABLE", ACCOUNT_DELETED_ERROR_CODE,
  "INVALID_ACCOUNT_PROVIDER", "BASE_ACCOUNT_DISABLED", "AMBIGUOUS_AUTHENTICATION",
] as const;
export type AuthBoundaryErrorCode = (typeof AUTH_BOUNDARY_ERROR_CODES)[number];
export type AuthBoundaryErrorResponse = { error: { code: AuthBoundaryErrorCode; message: string } };

export function isAuthBoundaryErrorCode(value: unknown): value is AuthBoundaryErrorCode {
  return typeof value === "string" && AUTH_BOUNDARY_ERROR_CODES.some((code) => code === value);
}

export function parseAuthBoundaryErrorResponse(value: unknown): AuthBoundaryErrorResponse | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "error") ||
    !isRecord(value.error) || Object.keys(value.error).length !== 2 ||
    !Object.hasOwn(value.error, "code") || !Object.hasOwn(value.error, "message") ||
    !isAuthBoundaryErrorCode(value.error.code) || typeof value.error.message !== "string") return null;
  return { error: { code: value.error.code, message: value.error.message } };
}
