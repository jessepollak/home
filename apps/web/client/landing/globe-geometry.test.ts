import { describe, expect, test } from "bun:test";
import {
  clampViewLatitude,
  geographicVector,
  INITIAL_VIEW_LATITUDE,
  MAX_VIEW_LATITUDE,
  projectCountry,
} from "./globe-geometry";
import { advanceMotion, DEFAULT_VELOCITY } from "./globe-motion";

describe("two-axis globe view", () => {
  test("view latitude truthfully changes projected y and depth", () => {
    const level = projectCountry(20, 35, -28, 0);
    const tilted = projectCountry(20, 35, -28, 35);
    expect(tilted.y).not.toBeCloseTo(level.y);
    expect(tilted.depth).not.toBeCloseTo(level.depth);
    expect(projectCountry(20, 35)).toEqual(projectCountry(20, 35, -28, INITIAL_VIEW_LATITUDE));
  });

  test("clamps latitude before poles can flip", () => {
    expect(clampViewLatitude(500)).toBe(MAX_VIEW_LATITUDE);
    expect(clampViewLatitude(-500)).toBe(-MAX_VIEW_LATITUDE);
  });

  test("integrates both auto longitude and zero-target latitude inertia independent of frame rate", () => {
    const integrate = (velocity: number, target: number, steps: number) => {
      let current = velocity;
      let distance = 0;
      for (let index = 0; index < steps; index++) {
        const next = advanceMotion(current, 900 / steps, target);
        current = next.velocity;
        distance += next.distance;
      }
      return { velocity: current, distance };
    };
    const longitude30 = integrate(.12, DEFAULT_VELOCITY, 30);
    const longitude90 = integrate(.12, DEFAULT_VELOCITY, 90);
    const latitude30 = integrate(-.1, 0, 30);
    const latitude90 = integrate(-.1, 0, 90);
    expect(longitude30.distance).toBeCloseTo(longitude90.distance, 8);
    expect(latitude30.distance).toBeCloseTo(latitude90.distance, 8);
    expect(latitude30.velocity).toBeCloseTo(latitude90.velocity, 8);
    expect(Math.abs(latitude30.velocity)).toBeLessThan(.04);
    expect(DEFAULT_VELOCITY).toBe(.0075);
  });

  test("keeps the geographic unit-vector contract", () => {
    const vector = geographicVector(45, 30);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
  });
});
