export type AssetFact = {
  assetId: string;
  contractAddress: string;
  summary: string;
  source: { label: string; url: string };
  checkedAt: string;
};

export type AssetCatalyst = {
  assetId: string;
  contractAddress: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  expiresAt: string;
};

function https(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
}

export function selectAssetContext(
  asset: { id: string; contractAddress: string },
  facts: readonly AssetFact[],
  catalysts: readonly AssetCatalyst[],
  now: number,
) {
  const matches = (entry: { assetId: string; contractAddress: string }) =>
    entry.assetId === asset.id && entry.contractAddress.toLowerCase() === asset.contractAddress.toLowerCase();
  return {
    fact: facts.find((entry) => matches(entry) && entry.summary.trim() && entry.source.label.trim()
      && https(entry.source.url) && /^\d{4}-\d{2}-\d{2}$/.test(entry.checkedAt) && Number.isFinite(date(entry.checkedAt))),
    catalysts: catalysts.filter((entry) => matches(entry) && entry.title.trim() && entry.publisher.trim()
      && https(entry.url) && date(entry.publishedAt) <= now && now < date(entry.expiresAt)),
  };
}
