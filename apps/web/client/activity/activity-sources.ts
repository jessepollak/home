import type { ActivityState } from "./types";

export type ActivityFeedSource = "transfers" | "actions" | "orders";
export type ActivitySourceReadiness = "loading" | "ready" | "error" | "unavailable";

const sourceOrder: readonly ActivityFeedSource[] = ["transfers", "actions", "orders"];

export const activitySourcesAttribute = (sources: Record<ActivityFeedSource, ActivitySourceReadiness>): string =>
  sourceOrder.map((source) => `${source}:${sources[source]}`).join(" ");

export const sourceReadiness = (status: ActivitySourceReadiness, refreshing: boolean, failed = false): ActivitySourceReadiness => refreshing ? "loading" : failed ? "error" : status;

export const transfersReadiness = (activity: ActivityState & { refreshing?: boolean; failed?: boolean }): ActivitySourceReadiness => {
  if (activity.refreshing) return "loading";
  if (activity.failed) return "error";
  if (activity.status !== "ready") return activity.status;
  if (activity.page.onchainStatus === "unavailable") return "unavailable";
  if (activity.latestUnavailable) return "error";
  if (activity.loadMoreError) return "error";
  return activity.page.nextCursor === null ? "ready" : "loading";
};
