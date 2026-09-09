// No-op: touch apps/web so Vercel preview rebuilds after Neon prune (empty/docs-only commits can skip).
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const MAX_URL_LENGTH = 2_048;

export function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  const rewritten = rewriteIpfsUrl(trimmed);
  let url: URL;
  try {
    url = new URL(rewritten);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.hash) return null;
  return url.toString();
}

function rewriteIpfsUrl(value: string): string {
  if (value.startsWith("ipfs://")) {
    const path = value.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `${IPFS_GATEWAY}${path}`;
  }
  return value;
}
