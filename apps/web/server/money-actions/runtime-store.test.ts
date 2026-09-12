import { afterEach, describe, expect, test } from "bun:test";
import {
  getMoneyActionStore,
  resolveMoneyActionStoreBackend,
  setMoneyActionRuntimeStoreFactoryForTests,
  setMoneyActionStoreForTests,
} from "./runtime-store";
import { MemoryMoneyActionStore } from "./store";

const originalUrl = process.env.DATABASE_URL;
const originalCutover = process.env.MONEY_ACTION_POSTGRES_CUTOVER;

afterEach(() => {
  setMoneyActionRuntimeStoreFactoryForTests(null);
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

  test("retries a rejected runtime readiness single-flight", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    const first = new RuntimeTestStore();
    const recovered = new RuntimeTestStore();
    const failure = deferred<void>();
    let factoryCalls = 0;
    let readinessCalls = 0;
    setMoneyActionRuntimeStoreFactoryForTests(async () => {
      factoryCalls += 1;
      const store = factoryCalls === 1 ? first : recovered;
      store.readiness = async () => {
        readinessCalls += 1;
        if (store === first) await failure.promise;
      };
      return store;
    });

    const failures = Promise.allSettled([getMoneyActionStore(), getMoneyActionStore()]);
    await Promise.resolve();
    expect(factoryCalls).toBe(1);
    failure.reject(new Error("transient runtime readiness failure"));
    const outcomes = await failures;
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { message: "transient runtime readiness failure" } },
      { status: "rejected", reason: { message: "transient runtime readiness failure" } },
    ]);
    expect(first.disposeCalls).toBe(1);

    await expect(getMoneyActionStore()).resolves.toBe(recovered);
    await expect(getMoneyActionStore()).resolves.toBe(recovered);
    expect(factoryCalls).toBe(2);
    expect(readinessCalls).toBe(2);
  });

  test("bounds failed runtime cleanup without masking the readiness error", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    const store = new RuntimeTestStore();
    const readinessError = new Error("original readiness failure");
    store.readiness = async () => { throw readinessError; };
    store.disposal = () => new Promise<void>(() => {});
    setMoneyActionRuntimeStoreFactoryForTests(async () => store);

    const startedAt = Date.now();
    let failure: unknown;
    try {
      await getMoneyActionStore();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBe(readinessError);
    expect(store.disposeCalls).toBe(1);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
    expect(Date.now() - startedAt).toBeLessThan(6_500);
  }, 7_000);

  test("an older rejected load cannot clear a newer successful runtime promise", async () => {
    process.env.DATABASE_URL = "postgresql://example/home";
    process.env.MONEY_ACTION_POSTGRES_CUTOVER = "verified-empty";
    const stale = new RuntimeTestStore();
    const current = new RuntimeTestStore();
    const staleFailure = deferred<void>();
    stale.readiness = () => staleFailure.promise;
    let factoryCalls = 0;
    setMoneyActionRuntimeStoreFactoryForTests(async () => {
      factoryCalls += 1;
      return factoryCalls === 1 ? stale : current;
    });

    const staleLoad = Promise.allSettled([getMoneyActionStore()]);
    await Promise.resolve();
    setMoneyActionStoreForTests(null);
    await expect(getMoneyActionStore()).resolves.toBe(current);
    staleFailure.reject(new Error("stale readiness failure"));
    expect(await staleLoad).toMatchObject([{ status: "rejected", reason: { message: "stale readiness failure" } }]);
    await expect(getMoneyActionStore()).resolves.toBe(current);
    expect(factoryCalls).toBe(2);
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

});

class RuntimeTestStore extends MemoryMoneyActionStore {
  readiness: () => Promise<void> = async () => {};
  disposal: () => Promise<void> = async () => {};
  disposeCalls = 0;

  ensureSchema(): Promise<void> {
    return this.readiness();
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    await this.disposal();
  }
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
