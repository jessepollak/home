import { describe, expect, test } from "bun:test";
import { GET, dynamic, runtime } from "./route";

describe("GET /api/savings/positions route composition", () => {
  test("is dynamic, Node-only, and rejects unauthenticated reads before Morpho", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    const response = await GET(new Request("http://127.0.0.1:3122/api/savings/positions"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Home-Account-Provider");
  });
});
