import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { GET, dynamic, maxDuration, runtime } from "./route";

afterEach(() => setObservabilityLogWriterForTests());

describe("GET /api/activity route composition", () => {
  test("uses the Node runtime, stays dynamic, and observes unauthenticated rejection before CDP SQL", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(30);
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));

    const response = await GET(
      new Request(
        "http://127.0.0.1:3115/api/activity?to=2026-09-07T12%3A00%3A00.000Z",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe(
      "Authorization, X-Home-Account-Provider",
    );
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        kind: "activity-read",
        outcome: "rejected",
        reason: "authorization",
        source: "none",
      }),
    ]);
  });
});
