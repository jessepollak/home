import "server-only";

const removedAssets: ReadonlySet<string> = new Set();

export function tradeBuyBlocked(assetId: string, removed: ReadonlySet<string> = removedAssets): boolean {
  return removed.has(assetId);
}
