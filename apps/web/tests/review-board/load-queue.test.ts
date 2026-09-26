import { describe, expect, test } from "bun:test";
import { createLoadQueue } from "../../stories/review/explorations/board/load-queue";
describe("frame scheduler", () => {
  test("loads near center first, drains automatically after completion", () => {
    const queue = createLoadQueue(
      [0, 200, 400].map((x) => ({ id: `${x}`, x, y: 0, width: 20, height: 20 })),
      2,
    );
    expect(queue.take({ x: 210, y: 10 })).toEqual(["200", "0"]);
    expect(queue.take({ x: 410, y: 10 })).toEqual([]);
    queue.complete("200");
    expect(queue.take({ x: 410, y: 10 })).toEqual(["400"]);
    queue.complete("0");
    queue.complete("400");
    expect(queue.pending()).toBe(0);
  });
  test("requeues an active frame at its original position without increasing pending count", () => {
    const queue = createLoadQueue(
      [0, 200, 400].map((x) => ({ id: `${x}`, x, y: 0, width: 20, height: 20 })),
      1,
    );
    expect(queue.take({ x: 210, y: 10 })).toEqual(["200"]);
    queue.requeue("200");
    expect(queue.pending()).toBe(3);
    expect(queue.take({ x: 210, y: 10 })).toEqual(["200"]);
    expect(queue.take({ x: 410, y: 10 })).toEqual([]);
    queue.complete("200");
    expect(queue.take({ x: 410, y: 10 })).toEqual(["400"]);
  });
  test("rejects invalid concurrency", () => expect(() => createLoadQueue([], 0)).toThrow());
});
