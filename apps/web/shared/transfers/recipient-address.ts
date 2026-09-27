import { getAddress } from "viem";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export function normalizeResolvedRecipientAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!addressPattern.test(candidate) || /^0x0{40}$/i.test(candidate)) return null;
  return getAddress(candidate.toLowerCase());
}
