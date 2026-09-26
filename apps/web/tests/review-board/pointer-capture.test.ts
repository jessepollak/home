import { describe, expect, test } from "bun:test";
import { shouldCapturePointer } from "../../stories/review/explorations/board/desktop-canvas";

describe("review board pointer capture", () => {
  const start = { x: 100, y: 100 };

  test("keeps an ordinary frame click on its original target", () => {
    expect(shouldCapturePointer(false, 1)).toBe(false);
    expect(shouldCapturePointer(false, 1, start, start)).toBe(false);
    expect(shouldCapturePointer(false, 1, start, { x: 101, y: 101 })).toBe(false);
  });

  test("captures only after a drag crosses the threshold", () => {
    expect(shouldCapturePointer(false, 1, start, { x: 102, y: 101 })).toBe(true);
  });

  test("captures pan and pinch gestures immediately", () => {
    expect(shouldCapturePointer(true, 1)).toBe(true);
    expect(shouldCapturePointer(false, 2)).toBe(true);
  });
});
