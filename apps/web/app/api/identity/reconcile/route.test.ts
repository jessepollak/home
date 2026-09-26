import { afterEach, expect, test } from "bun:test";
import { POST } from "./route";

const previous = process.env.IDENTITY_RECONCILE_SECRET;
afterEach(() => {
  if (previous === undefined) delete process.env.IDENTITY_RECONCILE_SECRET;
  else process.env.IDENTITY_RECONCILE_SECRET = previous;
});
test("scheduled reconciliation fails closed without a valid secret and rejects missing or wrong bearer", async () => {
  const request = (authorization?: string) => new Request("https://home.test/api/identity/reconcile", { method: "POST", headers: authorization ? { authorization } : {} });
  delete process.env.IDENTITY_RECONCILE_SECRET;
  expect((await POST(request())).status).toBe(503);
  process.env.IDENTITY_RECONCILE_SECRET = "too-short";
  expect((await POST(request())).status).toBe(503);
  process.env.IDENTITY_RECONCILE_SECRET = "synthetic-scheduler-secret-32-characters";
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request("Bearer wrong"))).status).toBe(401);
});
