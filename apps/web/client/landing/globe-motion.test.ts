import { describe, expect, test } from "bun:test";
import { advanceMotion, boundedVelocity, DEFAULT_VELOCITY, MAX_VELOCITY, wrapLongitude } from "./globe-motion";

describe("bounded globe inertia", () => {
  test("caps flick speed in either direction", () => {
    expect(boundedVelocity(2)).toBe(MAX_VELOCITY);
    expect(boundedVelocity(-2)).toBe(-MAX_VELOCITY);
  });

  test("smoothly decays to gentle rotation in a frame-rate-independent way", () => {
    let velocity = MAX_VELOCITY;
    for (let i = 0; i < 240; i++) {
      const next = advanceMotion(velocity, 1000 / 30);
      expect(next.velocity).toBeLessThan(velocity);
      expect(next.velocity).toBeGreaterThan(DEFAULT_VELOCITY);
      velocity = next.velocity;
    }
    expect(velocity).toBeCloseTo(DEFAULT_VELOCITY, 4);
    const first = advanceMotion(MAX_VELOCITY, 50);
    const second = advanceMotion(first.velocity, 50);
    const combined = advanceMotion(MAX_VELOCITY, 100);
    expect(second.velocity).toBeCloseTo(combined.velocity, 10);
    expect(first.distance + second.distance).toBeCloseTo(combined.distance, 10);
    expect(advanceMotion(-MAX_VELOCITY, 100).velocity).toBeGreaterThan(-MAX_VELOCITY);
  });

  test("clamps stalled time and wraps longitude without antimeridian discontinuity", () => {
    expect(advanceMotion(DEFAULT_VELOCITY, 60_000).distance).toBe(.25);
    expect(advanceMotion(DEFAULT_VELOCITY, -1).distance).toBe(0);
    expect(wrapLongitude(181)).toBe(-179);
    expect(wrapLongitude(-181)).toBe(179);
    expect(wrapLongitude(-28 + 360 * 100)).toBe(-28);
  });
});
