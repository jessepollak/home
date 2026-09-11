import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresMoneyActionStore } from "./postgres-store";
import { getMoneyActionStore, resolveMoneyActionStoreBackend, setMoneyActionStoreForTests } from "./runtime-store";
import { MemoryMoneyActionStore } from "./store";

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  setMoneyActionStoreForTests(null);
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

describe("money action runtime store selection", () => {
  test("uses PostgreSQL only when DATABASE_URL is configured", () => {
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "postgresql://example/home" })).toBe("postgres");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "  postgresql://example/home  " })).toBe("postgres");
    expect(resolveMoneyActionStoreBackend({})).toBe("unconfigured");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "" })).toBe("unconfigured");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "   " })).toBe("unconfigured");
  });

  test("keeps an injected in-memory test double regardless of DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    await expect(getMoneyActionStore()).resolves.toBe(store);
  });

  test("loads the PostgreSQL adapter when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    setMoneyActionStoreForTests(null);
    const store = await getMoneyActionStore();
    expect(store).toBeInstanceOf(PostgresMoneyActionStore);
  });

  test("fails closed without DATABASE_URL in local and hosted runtimes", async () => {
    delete process.env.DATABASE_URL;
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).rejects.toThrow(/DATABASE_URL is required for PostgreSQL/);
  });

  test("production selection has no SQLite branch, import, or hosted alias dependency", () => {
    const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
    const postgres = readFileSync(resolve(import.meta.dir, "postgres-store.ts"), "utf8");
    expect(runtime).not.toContain("sqlite");
    expect(runtime).not.toContain("hosted-unconfigured");
    expect(postgres).not.toContain("node:sqlite");
    expect(postgres).not.toContain("sqlite-store");
    expect(runtime).toContain('await import("./postgres-store")');
  });
});
