import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { sanitizeImageUrl } from "../asset-icons/image-url";
import {
  executeCodexGraphql,
  readAddress,
  readInteger,
  readRecord,
  type FetchLike,
} from "./execute";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";

export const CODEX_TOKEN_IMAGES_QUERY = `query TokenImages($ids: [TokenInput!]!) {
  tokens(ids: $ids) {
    address
    networkId
    info {
      imageThumbUrl
      imageSmallUrl
      imageLargeUrl
    }
    asset {
      icon
    }
  }
}`;

const configuredIconAssets = [...stockAssets, ...cryptoAssets];

export async function readCodexTokenImages({
  apiKey,
  fetchImpl,
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: {
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
}): Promise<Map<string, string>> {
  const payload = await executeCodexGraphql({
    apiKey,
    query: CODEX_TOKEN_IMAGES_QUERY,
    variables: {
      ids: configuredIconAssets.map((asset) => ({
        address: asset.contractAddress,
        networkId: asset.chainId,
      })),
    },
    fetchImpl,
    timeoutMs,
  });

  const record = readRecord(payload);
  if (!record || !Array.isArray(record.tokens)) {
    return new Map();
  }

  const images = new Map<string, string>();
  for (const value of record.tokens) {
    const token = readRecord(value);
    if (!token) continue;
    const address = readAddress(token.address);
    const networkId = readInteger(token.networkId);
    if (!address || networkId === null) continue;

    const info = readRecord(token.info);
    const asset = readRecord(token.asset);
    const imageUrl =
      sanitizeImageUrl(info?.imageSmallUrl) ??
      sanitizeImageUrl(info?.imageThumbUrl) ??
      sanitizeImageUrl(info?.imageLargeUrl) ??
      sanitizeImageUrl(asset?.icon);
    if (!imageUrl) continue;
    images.set(contractKey(networkId, address), imageUrl);
  }
  return images;
}

export function contractKey(networkId: number, address: string) {
  return `${networkId}:${address.toLowerCase()}`;
}
