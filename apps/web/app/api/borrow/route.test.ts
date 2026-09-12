import { describe, expect, test } from "bun:test";
import { GET, POST, dynamic, runtime } from "./route";

describe("/api/borrow route composition", () => {
  test("is Node-only, dynamic, and rejects unauthenticated reads and previews before RPC", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    for (const response of [
      await GET(new Request("http://127.0.0.1:3115/api/borrow")),
      await POST(new Request("http://127.0.0.1:3115/api/borrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "borrow", amount: "1", snapshotBlockHash: `0x${"00".repeat(32)}` }),
      })),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Home-Account-Provider");
      expect(await response.json()).toEqual({
        error: { code: "UNAUTHENTICATED", message: "A valid access token is required." },
      });
    }
  });
});
