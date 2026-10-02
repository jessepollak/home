const prefix = "home-gzip-v1:";
export const ownerCacheCompressionThreshold = 128 * 1024;
const maxDecodedBytes = 32 * 1024 * 1024;
const maxEncodedCharacters = 8 * 1024 * 1024;

export function isCompressedOwnerCache(text: string): boolean {
  return text.startsWith(prefix);
}

export async function encodeOwnerCache(text: string): Promise<string> {
  const blob = new Blob([text]);
  if (blob.size > maxDecodedBytes) throw new Error("Owner cache is too large.");
  if (text.length < ownerCacheCompressionThreshold || typeof CompressionStream === "undefined") return text;
  const compressed = blob.stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 16_384));
  }
  const encoded = `${prefix}${btoa(binary)}`;
  if (encoded.length > maxEncodedCharacters) throw new Error("Owner cache is too large.");
  return encoded;
}

export async function decodeOwnerCache(text: string): Promise<string> {
  if (!isCompressedOwnerCache(text)) {
    if (text.length > maxDecodedBytes) throw new Error("Owner cache is too large.");
    return text;
  }
  if (text.length > maxEncodedCharacters || typeof DecompressionStream === "undefined") {
    throw new Error("Owner cache cannot be decoded.");
  }
  const binary = atob(text.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let decoded = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxDecodedBytes) throw new Error("Owner cache is too large.");
      decoded += decoder.decode(value, { stream: true });
    }
    return decoded + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
