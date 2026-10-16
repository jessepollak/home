import "server-only";

import { ACCOUNT_DELETED_ERROR_CODE, type AccountDeletionErrorCode } from "@/shared/account/contracts/account-deletion";
import type { AuthBoundaryErrorResponse } from "@/shared/account/contracts/auth-boundary";
import { privateJson } from "@/server/http/private-response";

export class AccountDeletionError extends Error {
  constructor(readonly code: AccountDeletionErrorCode) { super(code); }
}

export class AccountDeletedError extends Error {
  constructor() { super(ACCOUNT_DELETED_ERROR_CODE); }
}

export class AccountDeletionAuthUnavailable extends Error {
  constructor() { super("AUTH_UNAVAILABLE"); }
}

export function deletionAuthErrorResponse(error: unknown): Response | null {
  if (error instanceof AccountDeletedError) return privateJson({ error: { code: ACCOUNT_DELETED_ERROR_CODE, message: "This Home account has been deleted." } } satisfies AuthBoundaryErrorResponse, 401);
  if (error instanceof AccountDeletionAuthUnavailable) return privateJson({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication is temporarily unavailable." } } satisfies AuthBoundaryErrorResponse, 503);
  return null;
}
