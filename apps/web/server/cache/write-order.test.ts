import { describe, expect, test } from "bun:test";
import { createWriteOrder } from "./write-order";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("cache write order", () => {
  test("later-started wins when the older request settles last, including same-tick starts", async () => {
    const order = createWriteOrder();
    const older = deferred<string>();
    const newer = deferred<string>();
    const writes: string[] = [];
    const write = (value: string) => { writes.push(value); return true; };
    const first = order.settle("key", older.promise, write);
    const second = order.settle("key", newer.promise, write);
    expect(order.size).toBe(1);
    newer.resolve("newer");
    expect(await second).toBe("newer");
    expect(order.size).toBe(1);
    older.resolve("older");
    expect(await first).toBe("older");
    expect(writes).toEqual(["newer"]);
    expect(order.size).toBe(0);
  });

  test("writes both requests in start order when the older request settles first", async () => {
    const order = createWriteOrder();
    const older = deferred<string>();
    const newer = deferred<string>();
    const writes: string[] = [];
    const write = (value: string) => { writes.push(value); return true; };
    const first = order.settle("key", older.promise, write);
    const second = order.settle("key", newer.promise, write);
    older.resolve("older");
    await first;
    newer.resolve("newer");
    await second;
    expect(writes).toEqual(["older", "newer"]);
    expect(order.size).toBe(0);
  });

  test("a newer false write does not block an older valid value", async () => {
    const order = createWriteOrder();
    const older = deferred<string>();
    const newer = deferred<string>();
    const writes: string[] = [];
    const first = order.settle("key", older.promise, (value) => { writes.push(value); return true; });
    const second = order.settle("key", newer.promise, () => false);
    newer.resolve("uncached");
    expect(await second).toBe("uncached");
    older.resolve("older");
    await first;
    expect(writes).toEqual(["older"]);
    expect(order.size).toBe(0);
  });

  test("a newer rejection releases its writer and does not block an older valid value", async () => {
    const order = createWriteOrder();
    const older = deferred<string>();
    const newer = deferred<string>();
    const writes: string[] = [];
    const first = order.settle("key", older.promise, (value) => { writes.push(value); return true; });
    const second = order.settle("key", newer.promise, () => { throw new Error("unexpected write"); });
    newer.reject(new Error("provider failed"));
    await expect(second).rejects.toThrow("provider failed");
    expect(order.size).toBe(1);
    older.resolve("older");
    await first;
    expect(writes).toEqual(["older"]);
    expect(order.size).toBe(0);
    await expect(order.settle("other", Promise.reject(new Error("failed")), () => true)).rejects.toThrow("failed");
    expect(order.size).toBe(0);
  });

  test("a throwing write releases its writer without blocking the older value", async () => {
    const order = createWriteOrder();
    const older = deferred<string>();
    const writes: string[] = [];
    const first = order.settle("key", older.promise, (value) => { writes.push(value); return true; });
    await expect(order.settle("key", Promise.resolve("newer"), () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    older.resolve("older");
    await first;
    expect(writes).toEqual(["older"]);
    expect(order.size).toBe(0);
  });

  test("bookkeeping is bounded by outstanding keys rather than stalled writers", async () => {
    const order = createWriteOrder();
    const requests = Array.from({ length: 100 }, () => deferred<number>());
    const sameKey = requests.map((request) => order.settle("key", request.promise, () => true));
    expect(order.size).toBe(1);
    const otherRequests = Array.from({ length: 10 }, () => deferred<number>());
    const otherKeys = otherRequests.map((request, index) => order.settle(`other-${index}`, request.promise, () => true));
    expect(order.size).toBe(11);
    requests.forEach((request, index) => request.resolve(index));
    await Promise.all(sameKey);
    expect(order.size).toBe(10);
    otherRequests.forEach((request, index) => request.resolve(index));
    await Promise.all(otherKeys);
    expect(order.size).toBe(0);
    await order.settle("key", Promise.resolve(101), () => true);
    expect(order.size).toBe(0);
  });
});
