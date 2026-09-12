import { expect, test } from "bun:test";
import { GET } from "./route";

test("provider discovery is private and rejects before reading configured providers", async () => {
  const response = await GET(new Request("https://home.example/api/funding/providers?region=ID"));
  expect(response.ok).toBe(false);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
