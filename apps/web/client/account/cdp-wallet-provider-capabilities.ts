"use client";

import {
  BaseAccountConnectorError,
  type BaseAccountInvalidation,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { AccountProvider } from "@/shared/account/session-types";

type AccountProviderHint = AccountProvider | `pending:${AccountProvider}`;

export const ACCOUNT_PROVIDER_HINT_KEY = "home:account-provider";

export function hasAccountProviderHint(): boolean {
  try {
    const hint = window.sessionStorage.getItem(ACCOUNT_PROVIDER_HINT_KEY);
    return hint === "cdp-embedded" || hint === "base-account" ||
      hint === "pending:cdp-embedded" || hint === "pending:base-account";
  } catch {
    return false;
  }
}

export function writeAccountProviderHint(provider: AccountProviderHint | null) {
  try {
    if (provider) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, provider);
    } else {
      window.sessionStorage.removeItem(ACCOUNT_PROVIDER_HINT_KEY);
    }
  } catch {
    // This hint may only restrict restoration; storage is not an auth boundary.
  }
}

export type BaseAccountLoginFailure =
  | "disabled"
  | "cancelled"
  | "account-changed"
  | "chain-changed"
  | "provider-unavailable"
  | "verification-unsupported";

export class BaseAccountLoginError extends Error {
  readonly reason: BaseAccountLoginFailure;

  constructor(reason: BaseAccountLoginFailure, cause?: unknown) {
    super(reason, { cause });
    this.name = "BaseAccountLoginError";
    this.reason = reason;
  }
}

export function baseLoginFailureFromConnector(
  error: BaseAccountConnectorError,
): BaseAccountLoginFailure {
  switch (error.reason) {
    case "cancelled":
      return "cancelled";
    case "account-changed":
      return "account-changed";
    case "chain-changed":
      return "chain-changed";
    default:
      return "provider-unavailable";
  }
}

export async function releaseBaseAccountConnection(
  connection: ConnectedBaseAccount,
): Promise<void> {
  if (connection.release) {
    connection.release();
    return;
  }
  await connection.disconnect();
}

export function invalidationMessage(reason: BaseAccountInvalidation): string {
  switch (reason) {
    case "account-changed":
      return "The connected Base Account changed. Sign in again to continue.";
    case "chain-changed":
      return "The Base Account network changed. Switch to Base and sign in again.";
    default:
      return "The Base Account disconnected. Sign in again to continue.";
  }
}
