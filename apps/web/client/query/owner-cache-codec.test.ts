import { describe, expect, test } from "bun:test";
import { decodeOwnerCache, encodeOwnerCache, isCompressedOwnerCache } from "./owner-cache-codec";

describe("owner cache codec", () => {
  test("keeps small and legacy JSON readable", async () => {
    const text = JSON.stringify({ balance: "1", symbol: "€ 🪙" });
    expect(await encodeOwnerCache(text)).toBe(text);
    expect(await decodeOwnerCache(text)).toBe(text);
  });

  test("compresses a large Unicode payload losslessly", async () => {
    const text = JSON.stringify(Array.from({ length: 14_000 }, (_, index) => ({
      name: `Synthetic token ${index} € 🪙`, symbol: "TOKEN", source: "wallet",
      value: { status: "unpriced", reason: "price-unavailable" },
    })));
    const encoded = await encodeOwnerCache(text);
    expect(isCompressedOwnerCache(encoded)).toBe(true);
    expect(encoded.length).toBeLessThan(text.length / 5);
    expect(await decodeOwnerCache(encoded)).toBe(text);
  });

  test("rejects invalid base64 and invalid gzip", async () => {
    for (const value of ["home-gzip-v1:%%%", "home-gzip-v1:aW52YWxpZA=="]) {
      await expect(decodeOwnerCache(value)).rejects.toThrow();
    }
  });

  test("bounds decompressed output rather than trusting compressed size", async () => {
    const compressed = new Blob(["x".repeat(33 * 1024 * 1024)]).stream()
      .pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    const encoded = `home-gzip-v1:${btoa(String.fromCharCode(...bytes))}`;
    await expect(decodeOwnerCache(encoded)).rejects.toThrow("too large");
  });
});
