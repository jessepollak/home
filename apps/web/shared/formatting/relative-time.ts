export function formatRelativeTime(
  timestamp: string,
  nowMs = Date.now(),
): string {
  const timestampMs = Date.parse(timestamp);
  const elapsedSeconds = Number.isFinite(timestampMs)
    ? Math.max(0, Math.floor((nowMs - timestampMs) / 1_000))
    : 0;

  if (elapsedSeconds < 60) return "just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}
