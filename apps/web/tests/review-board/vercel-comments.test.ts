import { describe, expect, test } from "bun:test";
import { canvasClipPath, frameThrottle } from "../../stories/review/explorations/board/vercel-comments";

describe("Vercel Comments canvas sync", () => {
  test("converts canvas bounds to viewport insets, clamping offscreen edges", () => {
    expect(canvasClipPath({ top: 72, right: 840, bottom: 620, left: 260 },
      { width: 1200, height: 800 })).toBe("inset(72px 360px 180px 260px)");
    expect(canvasClipPath({ top: -40, right: 1300, bottom: 900, left: -30 },
      { width: 1200, height: 800 })).toBe("inset(0px 0px 0px 0px)");
  });

  test("runs once per frame, schedules trailing changes, and cancels pending work", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    let fired = 0;
    const throttle = frameThrottle(() => { fired += 1; },
      (callback) => { frames.set(++next, callback); return next; },
      (handle) => { frames.delete(handle); });
    throttle.schedule();
    throttle.schedule();
    throttle.schedule();
    expect(frames.size).toBe(1);
    frames.get(1)!(0);
    frames.delete(1);
    expect(fired).toBe(1);
    throttle.schedule();
    expect(frames.size).toBe(1);
    throttle.cancel();
    expect(frames.size).toBe(0);
    expect(fired).toBe(1);
    throttle.schedule();
    frames.get(3)!(0);
    expect(fired).toBe(2);
  });
});
