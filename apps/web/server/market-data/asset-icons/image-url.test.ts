import { describe, expect, test } from "bun:test";
import { sanitizeImageUrl } from "./image-url";

describe("sanitizeImageUrl", () => {
  test("keeps https image hosts and rewrites ipfs", () => {
    expect(sanitizeImageUrl("https://icons.example.test/btc.png")).toBe(
      "https://icons.example.test/btc.png",
    );
    expect(sanitizeImageUrl("ipfs://QmHash/logo.png")).toBe(
      "https://ipfs.io/ipfs/QmHash/logo.png",
    );
  });

  test("rejects unsafe or empty values", () => {
    expect(sanitizeImageUrl("http://icons.example.test/btc.png")).toBeNull();
    expect(sanitizeImageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeImageUrl("")).toBeNull();
    expect(sanitizeImageUrl(null)).toBeNull();
  });
});
