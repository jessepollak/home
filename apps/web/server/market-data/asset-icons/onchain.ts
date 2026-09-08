import { decodeFunctionResult, encodeFunctionData } from "viem";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { resolveBaseRpcUrl } from "@/server/portfolio/rpc";
import { sanitizeImageUrl } from "./image-url";

export const CONTRACT_URI_ABI = [
  {
    type: "function",
    name: "contractURI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const ONCHAIN_ICON_TIMEOUT_MS = 6_000;
export const ONCHAIN_METADATA_TIMEOUT_MS = 4_000;
export const ONCHAIN_METADATA_MAX_BYTES = 64_000;

const configuredIconAssets = [...stockAssets, ...cryptoAssets];

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function readOnchainIconImages({
  fetchImpl = fetch,
  rpcUrl = resolveBaseRpcUrl(),
  timeoutMs = ONCHAIN_ICON_TIMEOUT_MS,
}: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}): Promise<Map<string, string>> {
  const callData = encodeFunctionData({
    abi: CONTRACT_URI_ABI,
    functionName: "contractURI",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requests = configuredIconAssets.map((asset, index) => ({
      jsonrpc: "2.0" as const,
      id: index + 1,
      method: "eth_call",
      params: [{ to: asset.contractAddress, data: callData }, "latest"],
    }));

    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(requests),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return new Map();

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return new Map();

    const byId = new Map<number, string>();
    for (const item of payload) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        !("result" in item)
      ) {
        continue;
      }
      const id = typeof item.id === "number" ? item.id : Number(item.id);
      if (!Number.isInteger(id) || typeof item.result !== "string") continue;
      const uri = decodeContractUri(item.result);
      if (uri) byId.set(id, uri);
    }

    const images = new Map<string, string>();
    await Promise.all(
      configuredIconAssets.map(async (asset, index) => {
        const uri = byId.get(index + 1);
        if (!uri) return;
        const imageUrl = await readMetadataImage(uri, fetchImpl);
        if (!imageUrl) return;
        images.set(
          `${asset.chainId}:${asset.contractAddress.toLowerCase()}`,
          imageUrl,
        );
      }),
    );
    return images;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

export function decodeContractUri(data: string): string | null {
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) return null;
  try {
    const decoded = decodeFunctionResult({
      abi: CONTRACT_URI_ABI,
      functionName: "contractURI",
      data: data as `0x${string}`,
    });
    return typeof decoded === "string" && decoded.trim() ? decoded.trim() : null;
  } catch {
    return null;
  }
}

export async function readMetadataImage(
  uri: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const url = metadataRequestUrl(uri);
  if (!url) return readInlineMetadataImage(uri);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ONCHAIN_METADATA_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json, text/plain;q=0.8" },
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > ONCHAIN_METADATA_MAX_BYTES) return null;
    return imageFromMetadataJson(JSON.parse(text) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function imageFromMetadataJson(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return (
    sanitizeImageUrl(record.image) ??
    sanitizeImageUrl(record.image_url) ??
    sanitizeImageUrl(record.imageUrl)
  );
}

function metadataRequestUrl(uri: string): string | null {
  return sanitizeImageUrl(uri);
}

function readInlineMetadataImage(uri: string): string | null {
  const match = /^data:application\/json(?:;charset=utf-8)?;base64,(.+)$/i.exec(
    uri.trim(),
  );
  if (!match?.[1]) return null;
  try {
    const json = Buffer.from(match[1], "base64").toString("utf8");
    if (json.length > ONCHAIN_METADATA_MAX_BYTES) return null;
    return imageFromMetadataJson(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}
