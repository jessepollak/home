import "@/client/account/dom-test-harness";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, expect, test } from "bun:test";
import { searchFixture, nonTrendingAddress } from "@/tests/browser/feature-map/search-fixtures";
const { act, cleanup, render } = await import("@testing-library/react");
const { useInvestSearch } = await import("./use-invest-search");
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fakeClock() {
  let now = 0;
  const tasks = new Set<{ due: number; callback: () => void }>();
  return {
    schedule(callback: () => void, delay: number) {
      const task = { due: now + delay, callback };
      tasks.add(task);
      return () => { tasks.delete(task); };
    },
    advance(milliseconds: number) {
      now += milliseconds;
      for (const task of [...tasks]) {
        if (task.due > now) continue;
        tasks.delete(task);
        task.callback();
      }
    },
  };
}
function Probe({ query, composing = false, fetchImpl, schedule }: { query: string; composing?: boolean; fetchImpl: FetchLike; schedule: ReturnType<typeof fakeClock>["schedule"] }) {
  useInvestSearch(query, composing, { fetchImpl, schedule });
  return null;
}
const calls: string[] = [];
const fetchImpl: FetchLike = async (input) => {
  calls.push(String(input));
  return Response.json(searchFixture(new URL(String(input), "http://localhost").searchParams.get("q") ?? ""));
};
afterEach(() => { cleanup(); getHomeQueryClient().clear(); calls.length = 0; });
async function advance(clock: ReturnType<typeof fakeClock>, milliseconds: number) { await act(async () => { clock.advance(milliseconds); }); }

test("debounces text while complete addresses resolve immediately", async () => {
  const clock = fakeClock();
  const { rerender } = render(<Probe query="Bit" fetchImpl={fetchImpl} schedule={clock.schedule} />);
  await advance(clock, 199); expect(calls).toHaveLength(0);
  await advance(clock, 1); expect(calls).toHaveLength(1);
  rerender(<Probe query={nonTrendingAddress} fetchImpl={fetchImpl} schedule={clock.schedule} />);
  await advance(clock, 0); expect(calls).toHaveLength(2);
  expect(calls[1]).toContain(nonTrendingAddress);
});

test("composition does not dispatch until commit", async () => {
  const clock = fakeClock();
  const { rerender } = render(<Probe query="Apple" composing fetchImpl={fetchImpl} schedule={clock.schedule} />);
  await advance(clock, 300); expect(calls).toHaveLength(0);
  rerender(<Probe query="Apple" fetchImpl={fetchImpl} schedule={clock.schedule} />);
  await advance(clock, 199); expect(calls).toHaveLength(0);
  await advance(clock, 1); expect(calls).toHaveLength(1);
});
