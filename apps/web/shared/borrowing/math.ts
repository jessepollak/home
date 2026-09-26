export * from "@/shared/morpho-markets/math";

export function weightedAprWad(entries: ReadonlyArray<{ weight: bigint; aprWad: string }>): string | null {
  const total = entries.reduce((sum, entry) => sum + entry.weight, BigInt(0));
  if (total === BigInt(0)) return null;
  return (entries.reduce((sum, entry) => sum + entry.weight * BigInt(entry.aprWad), BigInt(0)) / total).toString();
}
