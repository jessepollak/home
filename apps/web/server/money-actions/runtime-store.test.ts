import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getMoneyActionStore, resolveMoneyActionStoreBackend, setMoneyActionStoreForTests } from "./runtime-store";
import { MemoryMoneyActionStore } from "./store";

const originalUrl = process.env.DATABASE_URL;
const originalCutover = process.env.MONEY_ACTION_POSTGRES_CUTOVER;

afterEach(() => {
  setMoneyActionStoreForTests(null);
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  if (originalCutover === undefined) delete process.env.MONEY_ACTION_POSTGRES_CUTOVER;
  else process.env.MONEY_ACTION_POSTGRES_CUTOVER = originalCutover;
});

describe("money action runtime store selection", () => {
  test("requires both PostgreSQL configuration and an explicit verified-empty cutover", () => {
    expect(resolveMoneyActionStoreBackend({
      DATABASE_URL: "postgresql://example/home",
      MONEY_ACTION_POSTGRES_CUTOVER: "verified-empty",
    })).toBe("postgres");
    expect(resolveMoneyActionStoreBackend({ DATABASE_URL: "postgresql://example/home" })).toBe("cutover-unverified");
    expect(resolveMoneyActionStoreBackend({
      DATABASE_URL: "postgresql://example/home",
      MONEY_ACTION_POSTGRES_CUTOVER: "unverified",
    })).toBe("cutover-unverified");
    expect(resolveMoneyActionStoreBackend({})).toBe("unconfigured");
  });

  test("keeps an injected in-memory test double regardless of cutover configuration", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    delete process.env.MONEY_ACTION_POSTGRES_CUTOVER;
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    await expect(getMoneyActionStore()).resolves.toBe(store);
  });

  test("loads and initializes the PostgreSQL attempt adapter only after verified-empty cutover", () => {
    const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
    expect(runtime).toContain("createPostgresAttemptStoreResourceWithExecutor");
    expect(runtime).toContain("await resource.init()");
    expect(runtime).toContain("return resource.store");
  });

  test("fails closed when DATABASE_URL is configured without cutover verification", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    delete process.env.MONEY_ACTION_POSTGRES_CUTOVER;
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).rejects.toThrow(/verifying no unresolved legacy SQLite money actions remain/);
  });

  test("fails closed without DATABASE_URL in local and hosted runtimes", async () => {
    delete process.env.DATABASE_URL;
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).rejects.toThrow(/DATABASE_URL is required for PostgreSQL/);
  });

  test("production selection has no SQLite adapter branch, import, or hosted alias dependency", () => {
    const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
    const postgres = readFileSync(resolve(import.meta.dir, "postgres-store.ts"), "utf8");
    expect(runtime).not.toContain("sqlite-store");
    expect(postgres).not.toContain("node:sqlite");
    expect(postgres).not.toContain("sqlite-store");
    expect(runtime).toContain('MONEY_ACTION_POSTGRES_CUTOVER === "verified-empty"');
    expect(runtime).toContain('await import("./postgres-store")');
  });
});
