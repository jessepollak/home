import { describe, expect, test } from "bun:test";
import {
  fitRect, initialFrameFit, MAX_ZOOM, pan, pinch, showFrameLabel, zoomAt,
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
    expect(camera).toEqual(fitRect({ width: 880, height: 852 }, first, 32));
    const selectedCamera = fitRect({ width: 880, height: 852 }, other, 32);
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
});
