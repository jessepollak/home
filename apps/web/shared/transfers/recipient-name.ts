import { getAddress } from "viem";
import { normalize } from "viem/ens";

const MAX_RECIPIENT_NAME_LENGTH = 255;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export function normalizeTransferRecipientName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > MAX_RECIPIENT_NAME_LENGTH) return null;
  let normalized: string;
  try {
    normalized = normalize(candidate);
  } catch {
    return null;
  }
  if (normalized.length === 0 || normalized.length > MAX_RECIPIENT_NAME_LENGTH) return null;
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return null;
  if (labels[labels.length - 1] !== "eth") return null;
  return normalized;
}

export function normalizeResolvedRecipientAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!addressPattern.test(candidate) || /^0x0{40}$/i.test(candidate)) return null;
  return getAddress(candidate.toLowerCase());
}
