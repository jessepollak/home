import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
import { scheduleAfterPaint } from "./after-paint";

let frame: FrameRequestCallback;
let cancelFrame: ReturnType<typeof spyOn<typeof window, "cancelAnimationFrame">>;

beforeEach(() => {
  jest.useFakeTimers();
  spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  cancelFrame = spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  jest.useRealTimers();
});

describe("scheduleAfterPaint", () => {
  test("runs after the animation frame and its following timeout", () => {
    const order: string[] = [];
    scheduleAfterPaint(() => order.push("run"));
    order.push("commit");
    jest.advanceTimersByTime(0);
    expect(order).toEqual(["commit"]);
    frame(0);
    order.push("frame");
    expect(order).toEqual(["commit", "frame"]);
    jest.advanceTimersByTime(0);
    expect(order).toEqual(["commit", "frame", "run"]);
    jest.advanceTimersByTime(0);
    expect(order).toEqual(["commit", "frame", "run"]);
  });

  test("cancels before the animation frame", () => {
    const run = mock(() => {});
    const cancel = scheduleAfterPaint(run);
    cancel();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    jest.advanceTimersByTime(0);
    expect(run).not.toHaveBeenCalled();
  });

  test("cancels between the animation frame and timeout", () => {
    const run = mock(() => {});
    const cancel = scheduleAfterPaint(run);
    frame(0);
    cancel();
    expect(cancelFrame).not.toHaveBeenCalled();
    jest.advanceTimersByTime(0);
    expect(run).not.toHaveBeenCalled();
  });
});
