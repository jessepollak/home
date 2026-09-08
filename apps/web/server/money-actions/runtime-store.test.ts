import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresMoneyActionStore } from "./postgres-store";
import { getMoneyActionStore, resolveMoneyActionStoreBackend, setMoneyActionStoreForTests } from "./runtime-store";
import { MemoryMoneyActionStore } from "./store";

const originalUrl = process.env.DATABASE_URL;
const originalVercel = process.env.VERCEL;

afterEach(() => {
  setMoneyActionStoreForTests(null);
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe("money action runtime store selection", () => {
  test("uses Postgres when DATABASE_URL is set and SQLite when it is not", () => {
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "postgresql://example/home" })).toBe("postgres");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "  postgresql://example/home  " })).toBe("postgres");
    expect(resolveMoneyActionStoreBackend({})).toBe("sqlite");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "" })).toBe("sqlite");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "   " })).toBe("sqlite");
  });

  test("does not fall back to SQLite on Vercel without DATABASE_URL", () => {
    expect(resolveMoneyActionStoreBackend({ VERCEL: "1" })).toBe("hosted-unconfigured");
    expect(resolveMoneyActionStoreBackend({ VERCEL: "1", DATABASE_URL: "postgresql://example/home" })).toBe("postgres");
  });

  test("keeps an injected test store regardless of DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    await expect(getMoneyActionStore()).resolves.toBe(store);
  });

  test("loads only the Postgres adapter when DATABASE_URL is set", async () => {
    delete process.env.VERCEL;
    process.env.DATABASE_URL = "postgresql://example/home";
    setMoneyActionStoreForTests(null);
    const store = await getMoneyActionStore();
    expect(store).toBeInstanceOf(PostgresMoneyActionStore);
  });

  test("fails closed on Vercel when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).rejects.toThrow(/DATABASE_URL is required/);
  });

  test("hosted selection source never statically imports node:sqlite", () => {
    const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
    const postgres = readFileSync(resolve(import.meta.dir, "postgres-store.ts"), "utf8");
    expect(postgres).not.toContain("node:sqlite");
    expect(postgres).not.toContain("sqlite-store");
    expect(runtime.indexOf('import("./postgres-store")')).toBeLessThan(runtime.indexOf('import("./sqlite-store.node")'));
    expect(runtime).toContain('if (backend === "hosted-unconfigured")');
  });
});
