import { expect, test } from "bun:test";
import { POST } from "./route";

test("oversize Immersve delivery is bounded and still receives 202", async () => {
  const response = await POST(new Request("https://home.test/api/cards/webhooks/immersve", {
    method: "POST",
    body: "a".repeat(64 * 1024 + 1),
  }));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
});
