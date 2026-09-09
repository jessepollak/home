import { describe, expect, test } from "bun:test";
import { POST, dynamic, runtime } from "./route";

describe("POST /api/funding/idrx-mint route composition", () => {
  test("uses Node, stays dynamic, and rejects unauthenticated creation before IDRX", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const request = new Request("http://localhost:3111/api/funding/idrx-mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Home-Account-Provider": "base-account",
      },
      body: JSON.stringify({
        assetId: "idrx",
        country: "ID",
        toBeMinted: "20000",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid access token is required.",
      },
    });
  });
});
