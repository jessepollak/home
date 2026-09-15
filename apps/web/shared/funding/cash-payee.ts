// Home-owned, side-effect-free payout-handle preview. The Peer adapter verifies
// this result against the pinned SDK before it authors any calldata.
export function canonicalizeCashPayee(platform: string, value: string): string {
  const trimmed = value.trim();
  if (platform === "cashapp") return trimmed.replace(/^\$+/, "");
  if (platform === "zelle") return trimmed.toLowerCase();
  return trimmed;
}
