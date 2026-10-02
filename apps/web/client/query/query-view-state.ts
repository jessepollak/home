export type QueryViewState = "loading" | "ready" | "empty" | "failed" | "failed-with-data";

export function queryViewState(
  query: { status: "pending" | "error" | "success" },
  options: { hasCachedData: boolean; isEmpty?: boolean; degraded?: boolean },
): QueryViewState {
  if (query.status === "error" || options.degraded === true) {
    return options.hasCachedData && !options.isEmpty ? "failed-with-data" : "failed";
  }
  if (query.status === "pending" || !options.hasCachedData) return "loading";
  return options.isEmpty ? "empty" : "ready";
}
