import { getAddress } from "viem";
import { parseAddress, requireAddress } from "@/shared/chain/hex";

const zeroAddress = requireAddress("0x0000000000000000000000000000000000000000");

export function normalizeResolvedRecipientAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("0x")) return null;
  const parsed = parseAddress(candidate.toLowerCase());
  if (!parsed || parsed === zeroAddress) return null;
  return getAddress(parsed);
}
