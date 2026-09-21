export function canonicalizeCashPayee(platform: string, value: string): string {
  const trimmed = value.trim();
  if (platform === "cashapp") return trimmed.replace(/^\$+/, "");
  if (platform === "zelle") return trimmed.toLowerCase();
  return trimmed;
}
