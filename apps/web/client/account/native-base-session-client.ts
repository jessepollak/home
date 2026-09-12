import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const flowIdPattern = /^[0-9a-f-]{16,64}$/;

export type NativeBaseFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function parseNativeBaseSession(value: unknown): VerifiedAccountSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<VerifiedAccountSession>;
  if (
    session.accountProvider !== "base-account" ||
    !session.user || typeof session.user.subject !== "string" || !session.user.subject ||
    !session.smartAccount ||
    typeof session.smartAccount.address !== "string" ||
    !addressPattern.test(session.smartAccount.address) ||
    session.smartAccount.chainId !== BASE_CHAIN_ID
  ) return null;
  return {
    user: { subject: session.user.subject },
    smartAccount: {
      address: session.smartAccount.address.toLowerCase() as `0x${string}`,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider: "base-account",
  };
}

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
  address: `0x${string}`,
  fetchImpl: NativeBaseFetch = fetch,
): Promise<{ flowId: string; message: string }> {
  const response = await fetchImpl("/api/auth/base/nonce", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Native Base authentication failed.");
  const value: unknown = await response.json().catch(() => null);
  if (
    !value || typeof value !== "object" ||
    !("message" in value) || typeof value.message !== "string" ||
    value.message.length === 0 || value.message.length > 16_384
  ) throw new Error("Native Base authentication failed.");
  const flowId = crypto.randomUUID();
  if (!flowIdPattern.test(flowId)) throw new Error("Native Base authentication failed.");
  return { flowId, message: value.message };
}

export async function verifyNativeBaseChallenge(
  message: string,
  signature: `0x${string}`,
  expectedAddress: `0x${string}`,
  fetchImpl: NativeBaseFetch = fetch,
): Promise<VerifiedAccountSession> {
  const response = await fetchImpl("/api/auth/base/verify", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  const session = await readSessionResponse(response);
  if (session.smartAccount?.address !== expectedAddress.toLowerCase()) {
    throw new Error("Native Base authentication failed.");
  }
  return session;
}

export async function clearNativeBaseSession(
  fetchImpl: NativeBaseFetch = fetch,
): Promise<void> {
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
