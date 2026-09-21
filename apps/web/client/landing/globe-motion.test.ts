import { describe, expect, test } from "bun:test";
import { advanceMotion, DEFAULT_VELOCITY } from "./globe-motion";

describe("globe inertia", () => {
  test("decay is independent of the frame interval", () => {
    const integrate = (steps: number) => {
      let velocity = 0.12;
      let distance = 0;
      for (let index = 0; index < steps; index += 1) {
        const next = advanceMotion(velocity, 900 / steps, DEFAULT_VELOCITY);
        velocity = next.velocity;
        distance += next.distance;
      }
      return { velocity, distance };
    };

    const at30Fps = integrate(30);
    const at90Fps = integrate(90);
    expect(at30Fps.velocity).toBeCloseTo(at90Fps.velocity, 8);
    expect(at30Fps.distance).toBeCloseTo(at90Fps.distance, 8);
  });
});
