import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttemptStoreResource } from "./attempt-store";
import {
  getMoneyActionStore,
  resolveMoneyActionStoreBackend,
  setMoneyActionRuntimeResourceFactoryForTests,
  setMoneyActionStoreForTests,
} from "./runtime-store";
import { MemoryMoneyActionStore, type MoneyActionStore } from "./store";

const originalUrl = process.env.DATABASE_URL;
const originalCutover = process.env.MONEY_ACTION_POSTGRES_CUTOVER;

afterEach(() => {
  setMoneyActionRuntimeResourceFactoryForTests(null);
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

  test("retries a rejected runtime single-flight only after disposing the failed resource", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    const firstStore = new MemoryMoneyActionStore();
    const recoveredStore = new MemoryMoneyActionStore();
    const failure = deferred<void>();
    const disposeStarted = deferred<void>();
    const finishDispose = deferred<void>();
    let factoryCalls = 0;
    let initCalls = 0;
    let disposeCalls = 0;
    setMoneyActionRuntimeResourceFactoryForTests(async () => {
      factoryCalls += 1;
      if (factoryCalls === 1) {
        return runtimeResource(firstStore, async () => {
          initCalls += 1;
          await failure.promise;
        }, async () => {
          disposeCalls += 1;
          disposeStarted.resolve();
          await finishDispose.promise;
        });
      }
      return runtimeResource(recoveredStore, async () => {
        initCalls += 1;
      }, async () => {
        disposeCalls += 1;
      });
    });

    const failures = Promise.allSettled([getMoneyActionStore(), getMoneyActionStore()]);
    await Promise.resolve();
    expect(factoryCalls).toBe(1);
    let failuresSettled = false;
    void failures.then(() => { failuresSettled = true; });
    failure.reject(new Error("transient runtime readiness failure"));
    await disposeStarted.promise;
    await Promise.resolve();
    expect(failuresSettled).toBe(false);
    finishDispose.resolve();
    const outcomes = await failures;
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect((outcome.reason as Error).message).toBe("transient runtime readiness failure");
      }
    }
    expect(disposeCalls).toBe(1);

    await expect(getMoneyActionStore()).resolves.toBe(recoveredStore);
    await expect(getMoneyActionStore()).resolves.toBe(recoveredStore);
    expect(factoryCalls).toBe(2);
    expect(initCalls).toBe(2);
    expect(disposeCalls).toBe(1);
  });

  test("an older rejected load cannot clear a newer successful runtime promise", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    const staleStore = new MemoryMoneyActionStore();
    const currentStore = new MemoryMoneyActionStore();
    const staleFailure = deferred<void>();
    let factoryCalls = 0;
    let staleDisposals = 0;
    setMoneyActionRuntimeResourceFactoryForTests(async () => {
      factoryCalls += 1;
      return factoryCalls === 1
        ? runtimeResource(staleStore, () => staleFailure.promise, async () => {
            staleDisposals += 1;
          })
        : runtimeResource(currentStore);
    });

    const stale = getMoneyActionStore();
    const staleOutcome = Promise.allSettled([stale]);
    await Promise.resolve();
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).resolves.toBe(currentStore);
    staleFailure.reject(new Error("stale readiness failure"));
    expect(await staleOutcome).toMatchObject([{ status: "rejected", reason: { message: "stale readiness failure" } }]);
    await expect(getMoneyActionStore()).resolves.toBe(currentStore);
    expect(factoryCalls).toBe(2);
    expect(staleDisposals).toBe(1);
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

function runtimeResource(
  store: MoneyActionStore,
  init: () => Promise<void> = async () => {},
  dispose: () => Promise<void> = async () => {},
): AttemptStoreResource {
  return {
    store: store as AttemptStoreResource["store"],
    init,
    dispose,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
