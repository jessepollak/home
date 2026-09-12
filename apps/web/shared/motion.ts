/**
 * Shared sheet spring. The stiffness targets a roughly 350 ms critical settle
 * across a full-height sheet; damping is the matching near-critical value for
 * mass 1, avoiding endpoint overshoot while preserving release velocity.
 */
export const MONEY_SHEET_SPRING = {
  type: "spring",
  stiffness: 750,
  damping: 55,
  mass: 1,
  restDelta: 0.5,
  restSpeed: 10,
} as const;
