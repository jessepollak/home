import { expect, test } from "bun:test";
import type { ObservabilityEvent } from "@/server/observability/schema";
import { createBalancesEnumerator } from "./enumerate";
import { createCdpTokenBalancesClient } from "./enumerate-cdp";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

test.each([
  { stop: "later-page rate limit", reason: "rate-limited", calls: 3, durationMs: 0 },
  { stop: "page-start budget", reason: "partial", calls: 1, durationMs: 2_500 },
])("incomplete inventory reports $reason for a $stop without losing collected rows", async ({ reason, calls, durationMs }) => {
  let clock = 0;
  let fetchCalls = 0;
  const events: ObservabilityEvent[] = [];
  const client = createCdpTokenBalancesClient({
    env: { CDP_API_KEY_ID: "key-id", ["CDP_API_KEY_" + "SECRET"]: "secret" },
    generateJwtImpl: async () => "signed-jwt",
    clock: { now: () => clock, timeout: () => new AbortController().signal },
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls > 1) return new Response("slow down", { status: 429 });
      clock = durationMs;
      return Response.json({
        balances: [{ amount: { amount: "42" }, token: { network: "base", contractAddress: TOKEN } }],
        nextPageToken: "page-two",
      });
    },
  });
  const enumerate = createBalancesEnumerator({ listBalances: client.listBalances, log: (event) => events.push(event) });

  expect(await enumerate(OWNER)).toEqual({
    status: "incomplete",
    rows: [{ contractAddress: TOKEN, amountBaseUnits: "42" }],
    nextCursor: "page-two",
    pagesRead: 1,
    durationMs,
  });
  expect(fetchCalls).toBe(calls);
  expect(events).toEqual([{
    kind: "portfolio-balance-source",
    route: "/api/balances",
    source: "cdp-token-balances",
    stage: "inventory",
    outcome: "incomplete",
    reason,
    pageCount: 1,
    durationMs,
  }]);
});
