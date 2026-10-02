import type { Query, QueryKey } from "@tanstack/react-query";
import { getHomeQueryClient } from "@/client/query/query-client";

type RefetchInterval = number | false | ((query: Query) => number | false | undefined);

export function refetchIntervalFor(key: QueryKey): number | false | undefined {
  const query = getHomeQueryClient().getQueryCache().find({ queryKey: key });
  if (!query) return undefined;
  const options: typeof query.options & { refetchInterval?: RefetchInterval } = query.options;
  const interval = options.refetchInterval;
  return typeof interval === "function" ? interval(query) : interval;
}
