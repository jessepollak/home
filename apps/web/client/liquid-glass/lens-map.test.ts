import { describe, expect, test } from "bun:test";
import { generateLensMaps, type LensOptions } from "./lens-map";

const options: LensOptions = { pixelRatio: 2, bezel: 9, thickness: 5 };
const shape = { width: 80, height: 32, radius: 16 };

function pixel(map: Uint8ClampedArray, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return [map[offset], map[offset + 1], map[offset + 2], map[offset + 3]];
}

describe("generateLensMaps", () => {
  test.each([
    [0.5, 80, 32],
    [1.5, 120, 48],
    [4, 160, 64],
  ])("clamps pixel ratio %s to map size %sx%s", (pixelRatio, width, height) => {
    const result = generateLensMaps(shape, { ...options, pixelRatio });
    expect([result.width, result.height]).toEqual([width, height]);
    expect(result.displacement.length).toBe(width * height * 4);
    expect(result.specular.length).toBe(width * height * 4);
  });

  test("outside pixels and the flat center have exactly neutral displacement", () => {
    const result = generateLensMaps(shape, options);
    expect(pixel(result.displacement, result.width, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixel(result.displacement, result.width, 80, 32)).toEqual([128, 128, 128, 255]);
    expect(pixel(result.specular, result.width, 0, 0)).toEqual([255, 255, 255, 0]);
  });

  test("mirrors both displacement axes across all four quadrants", () => {
    const result = generateLensMaps(shape, options);
    const { width, height, displacement } = result;
    for (const [x, y] of [[2, 29], [13, 2], [25, 4], [3, 20]]) {
      const [red, green] = pixel(displacement, width, x, y);
      const [rightRed, rightGreen] = pixel(displacement, width, width - x - 1, y);
      const [bottomRed, bottomGreen] = pixel(displacement, width, x, height - y - 1);
      expect(rightRed).toBe(red === 128 ? 128 : 255 - red);
      expect(rightGreen).toBe(green);
      expect(bottomRed).toBe(red);
      expect(bottomGreen).toBe(green === 128 ? 128 : 255 - green);
    }
  });

  test("a left rim pixel samples farther outside the glass under feDisplacementMap", () => {
    const result = generateLensMaps(shape, options);
    const midY = result.height / 2;
    const left = pixel(result.displacement, result.width, 0, midY)[0];
    const right = pixel(result.displacement, result.width, result.width - 1, midY)[0];
    expect(left).toBeLessThan(128);
    expect(right).toBeGreaterThan(128);
    expect(left).toBeLessThan(pixel(result.displacement, result.width, 8, midY)[0]);
    expect(result.scale * (left / 255 - 0.5)).toBeLessThan(0);
    expect(result.scale * (right / 255 - 0.5)).toBeGreaterThan(0);
  });

  test("physical displacement scale grows with glass thickness", () => {
    const thin = generateLensMaps(shape, { ...options, thickness: 2 });
    const thick = generateLensMaps(shape, { ...options, thickness: 8 });
    expect(thin.scale).toBeGreaterThan(0);
    expect(thick.scale).toBeGreaterThan(thin.scale);
    expect(thin.scale).toBeLessThan(2 * thick.scale);
  });

  test("a falloff profile caps travel at the thickness and spreads it across the bezel", () => {
    const convex = generateLensMaps(shape, options);
    const eased = generateLensMaps(shape, { ...options, falloff: 1.6 });
    const travel = (result: typeof convex, y: number) => Math.abs(pixel(result.displacement, result.width, 80, y)[1] - 127.5) / 127.5 * result.scale / 2;
    expect(generateLensMaps(shape, { ...options, falloff: 0 }).displacement).toEqual(convex.displacement);
    expect(eased.scale).toBeLessThanOrEqual(2 * options.thickness);
    expect(eased.scale).toBeGreaterThan(convex.scale / 2);
    expect(travel(eased, 8)).toBeGreaterThan(2 * travel(convex, 8));
    expect(travel(eased, 0)).toBeGreaterThan(travel(eased, 8));
    expect(pixel(eased.displacement, eased.width, 80, 18)[1]).toBe(128);
  });

  test("the rim highlight favors the top-left light and retains a faint opposite edge", () => {
    const result = generateLensMaps(shape, options);
    const alpha = (x: number, y: number) => pixel(result.specular, result.width, x, y)[3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(80, 32)).toBe(0);
    expect(alpha(28, 2)).toBeGreaterThan(alpha(28, 61));
    expect(alpha(28, 61)).toBeGreaterThan(0);
    expect(alpha(2, 29)).toBeGreaterThan(alpha(157, 29));
  });

  test("clamps oversized radii and bezels without invalid channel values", () => {
    const result = generateLensMaps({ width: 15, height: 9, radius: 200 }, {
      ...options, bezel: 100,
    });
    const clamped = generateLensMaps({ width: 15, height: 9, radius: 4.5 }, {
      ...options, bezel: 4.5,
    });
    expect(result.displacement).toEqual(clamped.displacement);
    expect(result.specular).toEqual(clamped.specular);
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(result.scale).toBeGreaterThan(0);
  });

  test("odd dimensions keep the center axis neutral and mirrored", () => {
    const result = generateLensMaps({ width: 31, height: 15, radius: 7 }, {
      ...options, pixelRatio: 1,
    });
    expect(pixel(result.displacement, result.width, 15, 0)[0]).toBe(128);
    expect(pixel(result.displacement, result.width, 0, 7)[1]).toBe(128);
    expect(pixel(result.displacement, result.width, 15, 7)).toEqual([128, 128, 128, 255]);
  });
});
