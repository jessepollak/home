import { describe, expect, test } from "bun:test";
import { GET, dynamic, runtime } from "./route";

describe("GET /api/portfolio route composition", () => {
  test("uses the Node runtime, stays dynamic, and rejects unauthenticated reads before RPC", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const response = await GET(
      new Request("http://127.0.0.1:3115/api/portfolio?mode=base-account"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe(
      "Cookie, Authorization, X-Home-Account-Provider",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid access token is required.",
      },
    });
  });
});
