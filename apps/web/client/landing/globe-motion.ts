/** Degrees per millisecond. Inertia approaches the gentle default, never zero. */
export const DEFAULT_VELOCITY = .0025;
export const MAX_VELOCITY = .18;
const DECAY_TIME = 900;

export function boundedVelocity(value: number) {
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, value));
}

/** Exact exponential integration keeps decay independent of the frame rate. */
export function advanceMotion(velocity: number, elapsed: number) {
  const time = Math.max(0, Math.min(elapsed, 100));
  const decay = Math.exp(-time / DECAY_TIME);
  return {
    velocity: DEFAULT_VELOCITY + (velocity - DEFAULT_VELOCITY) * decay,
    distance: DEFAULT_VELOCITY * time + (velocity - DEFAULT_VELOCITY) * DECAY_TIME * (1 - decay),
  };
}

export function wrapLongitude(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
