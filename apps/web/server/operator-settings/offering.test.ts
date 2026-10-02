import { afterEach, describe, expect, test } from "bun:test";
import { deploymentProductSettings } from "@/shared/operator-settings/products";
import { invalidateProductOffering, PRODUCT_OFFERING_TTL_MS, readProductOffering } from "./offering";
import type { OperatorSettingsStore } from "./store";
import type { SqlQueryOptions } from "@/server/db/sql";

const settings = deploymentProductSettings();
const row = (source: "default" | "stored", value: unknown = settings) => ({ domain: "products", settings: { source, value, revision: source === "default" ? 0 : 1, updatedAt: null, updatedBy: null } });
const reader = (read: () => Promise<ReturnType<typeof row>>): { store: () => Pick<OperatorSettingsStore, "read"> } => ({ store: () => ({ read }) });

afterEach(invalidateProductOffering);

describe("product offering reader", () => {
  test("deployment without a database and a missing row use compiled defaults", async () => {
    expect((await readProductOffering({ env: {} })).source).toBe("deployment");
    const result = await readProductOffering(reader(async () => row("default")));
    expect(result).toMatchObject({ source: "deployment", products: settings.products });
  });
  test("bounds the underlying store read with the offering timeout", async () => {
    const reads: Array<{ domain: string; timeoutMs?: number }> = [];
    const capturing = (): Pick<OperatorSettingsStore, "read"> => ({ read: async (domain: string, options?: SqlQueryOptions) => {
      reads.push({ domain, timeoutMs: options?.timeoutMs });
      return row("default");
    } });
    await readProductOffering({ store: capturing });
    expect(reads).toEqual([{ domain: "products", timeoutMs: 2_000 }]);
    reads.length = 0;
    await readProductOffering({ store: capturing, timeoutMs: 25 });
    expect(reads).toEqual([{ domain: "products", timeoutMs: 25 }]);
  });
  test("saved rows narrow, while store failures, timeouts, and invalid rows fail closed", async () => {
    const saved = { ...settings, products: { ...settings.products, save: "exit-only" as const } };
    expect(await readProductOffering(reader(async () => row("stored", saved)))).toMatchObject({ source: "saved", products: saved.products });
    expect((await readProductOffering(reader(async () => { throw new Error("db down"); }))).source).toBe("unavailable");
    expect((await readProductOffering({ ...reader(async () => new Promise<ReturnType<typeof row>>(() => {})), timeoutMs: 1 })).source).toBe("unavailable");
    expect((await readProductOffering(reader(async () => row("stored", { ...settings, unexpected: true })))).source).toBe("unavailable");
    expect((await readProductOffering(reader(async () => { throw new Error("newer schema"); }))).products.send).toBe("off");
  });
  test("in-process cache expires and invalidation replaces a cached offering", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    invalidateProductOffering();
    try {
      const first = await readProductOffering({ now: () => 10 });
      expect(await readProductOffering({ now: () => 10 + PRODUCT_OFFERING_TTL_MS - 1 })).toBe(first);
      const expired = await readProductOffering({ now: () => 10 + PRODUCT_OFFERING_TTL_MS });
      expect(expired).not.toBe(first);
      invalidateProductOffering();
      expect(await readProductOffering({ now: () => 11 + PRODUCT_OFFERING_TTL_MS })).not.toBe(expired);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
