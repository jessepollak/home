/**
 * Shared sheet-motion token. `type: "spring"` with no stiffness/damping/mass
 * intentionally keeps Motion's native spring defaults (100 / 10 / 1); surfaces
 * must reuse this token instead of re-deriving per-flow easing.
 */
export const MONEY_SHEET_SPRING = { type: "spring" } as const;
