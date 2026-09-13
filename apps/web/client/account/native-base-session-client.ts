import { deploymentHeaders } from "@/client/query/deployment-headers";
import {
  ACCOUNT_PROVIDER_HEADER,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import { parseNativeBaseNonceResponse, type NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import { parseNativeBaseSession } from "@/shared/account/contracts/base-verify";

export type NativeBaseFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function readSessionResponse(response: Response): Promise<VerifiedAccountSession> {
  if (!response.ok) throw new Error("Native Base authentication failed.");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Native Base authentication failed.");
  }
  const session = parseNativeBaseSession(value);
  if (!session) throw new Error("Native Base authentication failed.");
  return session;
}

export async function restoreNativeBaseSession(
  fetchImpl: NativeBaseFetch = fetch,
  signal?: AbortSignal,
): Promise<VerifiedAccountSession | null> {
  let response: Response;
  try {
    response = await fetchImpl("/api/session", {
      method: "GET",
      headers: {
        ...deploymentHeaders(),
        Accept: "application/json",
        [ACCOUNT_PROVIDER_HEADER]: "base-account",
      },
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    throw new Error("Native Base authentication failed.", { cause: error });
  }
  if (response.status === 401) return null;
  return readSessionResponse(response);
}

export async function requestNativeBaseChallenge(
  fetchImpl: NativeBaseFetch = fetch,
): Promise<NativeBaseChallenge> {
  const response = await fetchImpl("/api/auth/base/nonce", {
    method: "POST",
    headers: {
      ...deploymentHeaders(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Native Base authentication failed.");
  const value = parseNativeBaseNonceResponse(await response.json().catch(() => null));
  if (!value) throw new Error("Native Base authentication failed.");
  return value;
}

export async function verifyNativeBaseChallenge(
  address: `0x${string}`,
  message: string,
  signature: `0x${string}`,
  fetchImpl: NativeBaseFetch = fetch,
): Promise<VerifiedAccountSession> {
  const response = await fetchImpl("/api/auth/base/verify", {
    method: "POST",
    headers: {
      ...deploymentHeaders(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address, message, signature }),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  const session = await readSessionResponse(response);
  if (session.smartAccount?.address !== address.toLowerCase()) {
    throw new Error("Native Base authentication failed.");
  }
  return session;
}

export async function clearNativeBaseSession(
  fetchImpl: NativeBaseFetch = fetch,
): Promise<void> {
  // Never pin sign-out to the serving deployment. Logout only clears cookies
  // and is valid on any deployment; a pinned request from a tab older than the
  // Skew Protection max age would 404 and leave the user unable to sign out.
  const response = await fetchImpl("/api/auth/base/logout", {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Native Base sign-out failed.");
}

export function nativeOwnerKey(session: VerifiedAccountSession): string {
  if (session.accountProvider !== "base-account" || !session.smartAccount) {
    throw new Error("Native Base authentication failed.");
  }
  return `${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.smartAccount.chainId}`;
}
