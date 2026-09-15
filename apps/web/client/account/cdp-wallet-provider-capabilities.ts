"use client";

import {
  BaseAccountConnectorError,
  type BaseAccountInvalidation,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { AccountProvider } from "@/shared/account/session-types";

export type AccountProviderHint = AccountProvider | `pending:${AccountProvider}`;

export const ACCOUNT_PROVIDER_HINT_KEY = "home:account-provider";
export const CDP_RESTORE_MARKER_KEY = "home:cdp-restore";

export function writeCdpRestoreMarker(): void {
  try {
    window.localStorage.setItem(CDP_RESTORE_MARKER_KEY, "1");
  } catch {
    // This identity-free hint may only delay settlement; it grants no auth.
  }
}

export function hasCdpRestoreMarker(): boolean {
  try {
    return window.localStorage.getItem(CDP_RESTORE_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearCdpRenderHint(): void {
  try {
    window.localStorage.removeItem(CDP_RESTORE_MARKER_KEY);
  } catch {
    // Continue clearing the readable cookie when storage is unavailable.
  }
  if (typeof document === "undefined") return;
  try {
    document.cookie = "home-cdp-live=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  } catch {
    // The HttpOnly half is inert without this hint; logout also clears both halves.
  }
}

export function readAccountProviderHint(): AccountProviderHint | null {
  try {
    const hint = window.sessionStorage.getItem(ACCOUNT_PROVIDER_HINT_KEY);
    return hint === "cdp-embedded" || hint === "base-account" ||
      hint === "pending:cdp-embedded" || hint === "pending:base-account"
      ? hint
      : null;
  } catch {
    return null;
  }
}

function hasReadableCdpCookie(): boolean {
  try {
    const values = document.cookie.split(";").flatMap((part) => {
      const [name, ...value] = part.trim().split("=");
      return name === "home-cdp-live" ? [value.join("=")] : [];
    });
    return values.length === 1 && /^[0-9a-f]{48}$/.test(values[0]);
  } catch {
    return false;
  }
}

export function hasCdpRestoreHint(): boolean {
  const hint = readAccountProviderHint();
  return hint === "cdp-embedded" || hint === "pending:cdp-embedded" ||
    hasCdpRestoreMarker() || hasReadableCdpCookie();
}

export function readHomeAuthRestoreHint(): "none" | "cdp" | "base" {
  if (hasCdpRestoreHint()) return "cdp";
  const hint = readAccountProviderHint();
  return hint === "base-account" || hint === "pending:base-account" ? "base" : "none";
}

export function hasAccountProviderHint(): boolean {
  return readAccountProviderHint() !== null || hasCdpRestoreMarker() || hasReadableCdpCookie();
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
