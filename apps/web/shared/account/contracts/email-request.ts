import { parseAddress, type Address } from "@/shared/chain/hex";

export const EMAIL_REQUEST_VERSION = 1 as const;

export const EMAIL_REQUEST_ERROR_CODES = ["EMAIL_REQUEST_UNSUPPORTED", "EMAIL_REQUEST_UNAVAILABLE", "EMAIL_REQUEST_INVALID"] as const;
export type EmailRequestErrorCode = (typeof EMAIL_REQUEST_ERROR_CODES)[number];
export type EmailRequestErrorResponse = { error: { code: EmailRequestErrorCode } };
export function isEmailRequestErrorCode(value: unknown): value is EmailRequestErrorCode {
  return typeof value === "string" && (EMAIL_REQUEST_ERROR_CODES as readonly string[]).includes(value);
}
/** @public parses this route's wire error codes for shared client use */
export function parseEmailRequestErrorResponse(value: unknown): EmailRequestErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return isEmailRequestErrorCode(value.error.code) ? { error: { code: value.error.code } } : null;
}

export type EmailRequestChannel = "sign_in" | "share_step";
export type EmailRequestReadResponse = { version: 1; asked: boolean };
export type EmailRequestWrite =
  | { version: 1; kind: "sign_in_capability"; address: Address; result: "ignored" | "refused"; walletCode?: number; walletMessage?: string }
  | { version: 1; kind: "asked"; address: Address; channel: "share_step" }
  | { version: 1; kind: "answer"; address: Address; channel: EmailRequestChannel; answer: "not_now" | "declined" | "failed"; walletCode?: number; walletMessage?: string }
  | { version: 1; kind: "email"; address: Address; channel: EmailRequestChannel; email: string; bundleId?: string };
export type EmailRequestClaimWrite = { version: 1; kind: "claim"; address: Address; channel: "share_step" };
export type EmailRequestAnyWrite = EmailRequestWrite | EmailRequestClaimWrite;
export type EmailRequestWriteResponse = { version: 1; asked: boolean };
export type EmailRequestClaimResponse = { version: 1; claimed: boolean };

export function normalizeReportedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeAddress(value: unknown): Address | null {
  return parseAddress(value);
}

export function isWalletCode(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
}

export function parseEmailRequestWrite(value: unknown): EmailRequestAnyWrite | null {
  if (!isRecord(value) || value.version !== EMAIL_REQUEST_VERSION) return null;
  const address = normalizeAddress(value.address);
  if (!address) return null;
  if (value.kind === "claim") {
    return value.channel === "share_step" && hasOnly(value, ["version", "kind", "channel", "address"])
      ? { version: 1, kind: "claim", channel: "share_step", address } : null;
  }
  if (value.kind === "asked") {
    return value.channel === "share_step" && hasOnly(value, ["version", "kind", "channel", "address"])
      ? { version: 1, kind: "asked", channel: "share_step", address } : null;
  }
  if (value.kind === "email") {
    const email = normalizeReportedEmail(value.email);
    if (!email || !isChannel(value.channel) || !hasOnly(value, ["version", "kind", "channel", "email", "address", "bundleId"]) ||
      (value.bundleId !== undefined && (typeof value.bundleId !== "string" || value.bundleId.length < 1 || value.bundleId.length > 512))) return null;
    return { version: 1, kind: "email", channel: value.channel, email, address,
      ...(value.bundleId === undefined ? {} : { bundleId: value.bundleId }) };
  }
  if (value.kind !== "answer" && value.kind !== "sign_in_capability") return null;
  if (!hasOnly(value, value.kind === "answer"
    ? ["version", "kind", "channel", "answer", "address", "walletCode", "walletMessage"]
    : ["version", "kind", "result", "address", "walletCode", "walletMessage"]) ||
    (value.walletCode !== undefined && !isWalletCode(value.walletCode)) ||
    (value.walletMessage !== undefined && (typeof value.walletMessage !== "string" || value.walletMessage.length > 300))) return null;
  const wallet = {
    ...(value.walletCode === undefined ? {} : { walletCode: value.walletCode as number }),
    ...(value.walletMessage === undefined ? {} : { walletMessage: value.walletMessage as string }),
  };
  if (value.kind === "sign_in_capability") {
    return value.result === "ignored" || value.result === "refused"
      ? { version: 1, kind: "sign_in_capability", result: value.result, address, ...wallet } : null;
  }
  if (!isChannel(value.channel) || (value.answer !== "not_now" && value.answer !== "declined" && value.answer !== "failed") ||
    (value.answer === "not_now" && value.channel !== "share_step")) return null;
  return { version: 1, kind: "answer", channel: value.channel, answer: value.answer, address, ...wallet };
}

export function parseEmailRequestReadResponse(value: unknown): EmailRequestReadResponse | null {
  return isRecord(value) && value.version === 1 && typeof value.asked === "boolean" && hasOnly(value, ["version", "asked"])
    ? { version: 1, asked: value.asked } : null;
}

export function parseEmailRequestClaimResponse(value: unknown): EmailRequestClaimResponse | null {
  return isRecord(value) && value.version === 1 && typeof value.claimed === "boolean" && hasOnly(value, ["version", "claimed"])
    ? { version: 1, claimed: value.claimed } : null;
}

export function parseEmailRequestWriteResponse(value: unknown): EmailRequestWriteResponse | null {
  return parseEmailRequestReadResponse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).every((key) => names.includes(key));
}

function isChannel(value: unknown): value is EmailRequestChannel {
  return value === "sign_in" || value === "share_step";
}
