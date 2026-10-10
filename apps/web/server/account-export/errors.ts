import "server-only";

import type { AccountExportErrorCode } from "@/shared/account/contracts/data-export";

export class AccountExportError extends Error {
  constructor(readonly code: AccountExportErrorCode) {
    super(code);
  }
}
