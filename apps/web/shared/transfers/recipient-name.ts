import { normalize } from "viem/ens";

export { normalizeResolvedRecipientAddress } from "./recipient-address";

const MAX_RECIPIENT_NAME_LENGTH = 255;

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
