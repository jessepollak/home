import { describe, expect, test } from "bun:test";
import { GET, dynamic, runtime } from "./route";

describe("GET /api/funding/idrx-attempt route composition", () => {
  test("uses Node, stays dynamic, and authenticates before recovery", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    const response = await GET(new Request("http://localhost:3111/api/funding/idrx-attempt", {
      headers: { "X-Home-Account-Provider": "base-account" },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "A valid access token is required." },
    });
  });
});
