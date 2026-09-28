import { describe, expect, test } from "bun:test";
import { createAfterSchedule } from "./after-schedule";

describe("balances after scheduler", () => {
  test("starts a thunk before retaining its promise", async () => {
    const order: string[] = [];
    let retained: Promise<unknown> | null = null;
    const schedule = createAfterSchedule((task) => {
      order.push("retain");
      retained = task;
    }, () => {});

    schedule(async () => { order.push("start"); });
    expect(order).toEqual(["start", "retain"]);
    await retained;
  });

  test("falls back without throwing when after is unavailable", async () => {
    let unavailable = 0;
    const schedule = createAfterSchedule(() => { throw new Error("E468"); }, () => { unavailable += 1; });
    expect(() => schedule(Promise.resolve())).not.toThrow();
    expect(unavailable).toBe(1);
  });
});
