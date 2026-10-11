import "server-only";

import { ACCOUNT_DELETED_ERROR_CODE, type AccountDeletionErrorCode } from "@/shared/account/contracts/account-deletion";
import { privateError } from "@/server/http/private-response";

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
  if (error instanceof AccountDeletedError) return privateError(ACCOUNT_DELETED_ERROR_CODE, "This Home account has been deleted.", 401);
  if (error instanceof AccountDeletionAuthUnavailable) return privateError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
  return null;
}
