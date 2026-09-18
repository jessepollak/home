import { describe, expect, test } from "bun:test";
import nextConfig from "./next.config";

describe("global response security", () => {
  test("denies framing without restricting frames embedded by Home", async () => {
    const headers = await nextConfig.headers?.();
    expect(headers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "/:path*",
        headers: expect.arrayContaining([
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ]),
      }),
    ]));
  });
});
