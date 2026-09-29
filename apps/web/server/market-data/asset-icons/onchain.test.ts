import { describe, expect, test } from "bun:test";
import { readMetadataImage } from "./onchain";

const METADATA_URL = "https://metadata.example.test/token.json";
const IMAGE_URL = "https://images.example.test/token.png";

describe("on-chain icon metadata", () => {
  test("reads an image from metadata while following redirects", async () => {
    let redirect: RequestRedirect | undefined;
    const image = await readMetadataImage(METADATA_URL, async (_url, init) => {
      redirect = init?.redirect;
      return Response.json({ image: IMAGE_URL });
    });
    expect(redirect).toBe("follow");
    expect(image).toBe(IMAGE_URL);
  });

  test.each([
    ["non-ok response", () => new Response("unavailable", { status: 404 })],
    ["oversized metadata", () => Response.json({ image: IMAGE_URL, pad: "x".repeat(64_000) })],
    ["malformed JSON", () => new Response("{broken")],
  ] as const)("returns null for %s", async (_case, response) => {
    expect(await readMetadataImage(METADATA_URL, async () => response())).toBeNull();
  });
});
