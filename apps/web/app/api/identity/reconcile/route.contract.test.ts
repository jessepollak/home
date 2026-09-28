import { afterEach, expect, mock, test } from "bun:test";
import { readIdentityReconcile } from "@/shared/identity/contract";

const service = await import("@/server/identity/service");
await mock.module("@/server/identity/service", () => ({
  ...service,
  getIdentityService: () => ({ reconcileStale: async (limit: number) => ({ processed: Math.min(limit, 3), failed: 1 }) }),
}));

const { POST } = await import("./route");

const previous = process.env.IDENTITY_RECONCILE_SECRET;
afterEach(() => {
  if (previous === undefined) delete process.env.IDENTITY_RECONCILE_SECRET;
  else process.env.IDENTITY_RECONCILE_SECRET = previous;
});

const call = (authorization?: string) => POST(new Request("https://home.test/api/identity/reconcile", { method: "POST", headers: authorization ? { authorization } : {} }));

test("a valid scheduler bearer returns a versioned response the shared parser accepts", async () => {
  process.env.IDENTITY_RECONCILE_SECRET = "synthetic-scheduler-secret-32-characters";
  const response = await call(`Bearer ${process.env.IDENTITY_RECONCILE_SECRET}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  expect(readIdentityReconcile(body)).toEqual({ version: 1, processed: 3, failed: 1 });
  for (const skewed of [
    { version: 99, processed: 3, failed: 1 },
    { version: 1, processed: "3", failed: 1 },
    { version: 1, processed: 1, failed: 2 },
    { version: 1, processed: 51, failed: 0 },
    { version: 1, processed: 3 },
  ]) expect(readIdentityReconcile(skewed)).toBeNull();
});
