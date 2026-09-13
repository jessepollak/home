export type HapticFeedback = "selection" | "success" | "error";

const vibrationPattern: Record<HapticFeedback, number | number[]> = {
  selection: 10,
  success: [10, 30, 20],
  error: [20, 30, 20, 30, 20],
};

/** Best-effort tactile feedback. Unsupported or disabled vibration is a no-op. */
export function haptic(feedback: HapticFeedback) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  return navigator.vibrate(vibrationPattern[feedback]);
}
