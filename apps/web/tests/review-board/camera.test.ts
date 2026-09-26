import { describe, expect, test } from "bun:test";
import {
  fitRect, gestureCamera, initialFrameFit, MAX_ZOOM, pan, pinch, showFrameLabel, wheelCamera, zoomAt,
  type WheelInput,
} from "../../stories/review/explorations/board/camera";
describe("board camera", () => {
  test("fits an offset rect with padding", () =>
    expect(fitRect({ width: 1000, height: 600 }, { x: 50, y: 20, width: 400, height: 200 }, 100)).toEqual({
      x: 0,
      y: 60,
      zoom: 2,
    }));
  test("keeps the cursor fixed while zooming and clamps extremes", () => {
    expect(zoomAt({ x: 20, y: 30, zoom: 1 }, { x: 100, y: 100 }, 2)).toEqual({ x: -60, y: -40, zoom: 2 });
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.001).zoom).toBe(0.05);
  });
  test("applies the deep-linked frame fit only on the first successful canvas measurement", () => {
    const first = { x: 582, y: 112, width: 390, height: 844 };
    const other = { x: 96, y: 112, width: 390, height: 844 };
    expect(initialFrameFit({ width: 0, height: 852 }, first, false)).toBeUndefined();
    const camera = initialFrameFit({ width: 880, height: 852 }, first, false);
    expect(camera).toEqual(fitRect({ width: 880, height: 852 }, first, 32, 60));
    const selectedCamera = fitRect({ width: 880, height: 852 }, other, 32, 60);
    expect(initialFrameFit({ width: 640, height: 852 }, first, true)).toBeUndefined();
    expect(initialFrameFit({ width: 880, height: 852 }, first, true)).toBeUndefined();
    expect(selectedCamera).not.toEqual(camera);
  });
  test("shows frame labels only when the frame and the space above it can hold one", () => {
    expect(showFrameLabel(390, 0.2)).toBe(true);
    expect(showFrameLabel(390, 0.1)).toBe(false);
    expect(showFrameLabel(1440, 0.1)).toBe(false);
    expect(showFrameLabel(1440, 0.1, 400)).toBe(true);
  });
  test("pans by screen pixels", () =>
    expect(pan({ x: 10, y: 20, zoom: 0.5 }, { x: -5, y: 8 })).toEqual({ x: 5, y: 28, zoom: 0.5 }));
  test("pinch doubles zoom around the fixed midpoint", () =>
    expect(pinch({ x: 10, y: 20, zoom: 0.5 },
      [{ x: 50, y: 100 }, { x: 150, y: 100 }],
      [{ x: 0, y: 100 }, { x: 200, y: 100 }])).toEqual({ x: -80, y: -60, zoom: 1 }));
  test("pinch translation pans without zooming", () =>
    expect(pinch({ x: 10, y: 20, zoom: 0.5 },
      [{ x: 50, y: 100 }, { x: 150, y: 100 }],
      [{ x: 55, y: 90 }, { x: 155, y: 90 }])).toEqual({ x: 15, y: 10, zoom: 0.5 }));
  test("pinch clamps zoom at the maximum", () =>
    expect(pinch({ x: 30, y: 40, zoom: 1 },
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: -100, y: 0 }, { x: 200, y: 0 }])).toEqual({ x: 10, y: 80, zoom: MAX_ZOOM }));
  test("pinch with coincident starting points only pans and stays finite", () => {
    const camera = pinch({ x: 3, y: 4, zoom: 1 },
      [{ x: 10, y: 20 }, { x: 10, y: 20 }],
      [{ x: 15, y: 30 }, { x: 25, y: 40 }]);
    expect(camera).toEqual({ x: 13, y: 19, zoom: 1 });
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
  });
  const wheel: WheelInput = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false };
  test("small ctrl-wheel pinches use a 1.5x rate and preserve the pointer", () => {
    const camera = { x: 20, y: 30, zoom: 1 };
    const pointer = { x: 100, y: 110 };
    const next = wheelCamera(camera, { ...wheel, deltaY: -4 }, pointer, 800);
    const factor = Math.exp(0.06);
    expect(next.zoom).toBeCloseTo(factor);
    expect(next.x).toBeCloseTo(pointer.x - (pointer.x - camera.x) * factor);
    expect(next.y).toBeCloseTo(pointer.y - (pointer.y - camera.y) * factor);
  });
  test("large ctrl and Cmd wheel steps clamp each event but keep scroll behavior", () => {
    const camera = { x: 0, y: 0, zoom: 0.5 };
    const point = { x: 0, y: 0 };
    expect(wheelCamera(camera, { ...wheel, deltaY: -500 }, point, 800).zoom)
      .toBeCloseTo(0.5 * Math.exp(0.45));
    expect(wheelCamera(camera, { ...wheel, deltaY: -3, deltaMode: 1, ctrlKey: false, metaKey: true },
      point, 800).zoom).toBeCloseTo(0.5 * Math.exp(0.45));
    expect(wheelCamera(camera, { ...wheel, deltaY: 500, deltaMode: 2 }, point, 800).zoom)
      .toBeCloseTo(0.5 * Math.exp(-0.45));
    expect(wheelCamera(camera, { ...wheel, deltaX: 4, deltaY: 10, ctrlKey: false }, point, 800))
      .toEqual({ x: -4, y: -10, zoom: 0.5 });
  });
  test("Safari gesture scale ratios accumulate at the gesture point without compounding totals", () => {
    const camera = { x: 20, y: 30, zoom: 0.5 };
    const point = { x: 100, y: 110 };
    const first = gestureCamera(camera, 1, 1.2, point);
    const second = gestureCamera(first, 1.2, 1.5, point);
    expect(second.zoom).toBeCloseTo(0.75);
    expect(second.x).toBeCloseTo(point.x - (point.x - camera.x) * 1.5);
    expect(second.y).toBeCloseTo(point.y - (point.y - camera.y) * 1.5);
    expect(gestureCamera(camera, 1, 100, point).zoom).toBe(1);
    expect(gestureCamera(camera, 0, 1.5, point)).toEqual(camera);
    expect(gestureCamera(camera, 1, Number.NaN, point)).toEqual(camera);
  });
});

test("fitting a frame leaves top clearance for its label and the interaction chip", () => {
  const camera = fitRect({ width: 1000, height: 800 }, { x: 0, y: 0, width: 390, height: 844 }, 32, 60);
  expect(camera.y).toBeGreaterThanOrEqual(60);
  expect(camera.y + 844 * camera.zoom).toBeLessThanOrEqual(800 - 32 + 0.001);
});
