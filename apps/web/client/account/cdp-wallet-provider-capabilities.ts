"use client";

import {
  BaseAccountConnectorError,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { AccountProvider } from "@/shared/account/session-types";

export type AccountProviderHint = AccountProvider | `pending:${AccountProvider}`;

export const ACCOUNT_PROVIDER_HINT_KEY = "home:account-provider";
export const CDP_RESTORE_MARKER_KEY = "home:cdp-restore";

export function writeCdpRestoreMarker(): void {
  try {
    window.localStorage.setItem(CDP_RESTORE_MARKER_KEY, "1");
  } catch { // oxlint-disable-line home/no-silent-catch -- the restore marker is best-effort; the provider hint and cookie remain the restore path
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
  } catch { // oxlint-disable-line home/no-silent-catch -- blocked storage cannot be cleared; the restore walk tolerates a stale marker
  }
  if (typeof document === "undefined") return;
  try {
    document.cookie = "home-cdp-live=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  } catch { // oxlint-disable-line home/no-silent-catch -- cookie clearing is best-effort; blocked cookie access must not fail sign-out
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
  } catch { // oxlint-disable-line home/no-silent-catch -- the provider hint is a best-effort cache; marker and cookie detection still restore the account
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
