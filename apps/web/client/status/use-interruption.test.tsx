import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { getHomeQueryClient } from "@/client/query/query-client";
import { useBalances } from "@/client/balances/use-balances";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { FetchBalances } from "@/shared/balances/types";
import { onlineManager } from "@tanstack/react-query";
import { useInterruption, type InterruptionClock } from "./use-interruption";
import type { RecoverableBalancesState } from "@/client/balances/use-balances";

type Observation = RecoverableBalancesState["observation"];

function fakeClock() {
  let time = 100_000;
  let sequence = 0;
  const tasks = new Map<number, { due: number; callback: () => void }>();
  const clock: InterruptionClock = {
    now: () => time,
    setTimeout: (callback, delay) => {
      const id = ++sequence;
      tasks.set(id, { due: time + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => { tasks.delete(timer as unknown as number); },
  };
  return {
    clock,
    advance(ms: number) {
      const end = time + ms;
      while (true) {
        const item = [...tasks].sort((a, b) => a[1].due - b[1].due)[0];
        if (!item || item[1].due > end) break;
        time = item[1].due;
        tasks.delete(item[0]);
        item[1].callback();
      }
      time = end;
    },
  };
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  onlineManager.setOnline(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("useInterruption", () => {
  test("confirmation, hold, failure cancellation, recheck cap and manual Retry use foreground deadlines", async () => {
    const fake = fakeClock();
    let calls = 0;
    const retry = async () => { calls += 1; };
    const initial: Observation = {
      identity: "owner\u0000US", fetchStatus: "idle", errorUpdatedAt: 0,
      dataUpdatedAt: 0, failureEligible: false, hasData: false,
    };
    function Probe({ observation }: { observation: Observation }) {
      const result = useInterruption(observation, true, retry, fake.clock);
      return <><output>{result.interruption?.kind ?? "clear"}</output>
        <button type="button" onClick={result.retry}>Retry</button></>;
    }
    const view = render(<Probe observation={initial} />);
    const failure = { ...initial, errorUpdatedAt: 1, failureEligible: true };
    view.rerender(<Probe observation={failure} />);
    act(() => fake.advance(4_999));
    expect(view.getByText("clear")).toBeTruthy();
    expect(calls).toBe(0);
    act(() => fake.advance(1));
    expect(calls).toBe(1);
    view.rerender(<Probe observation={{ ...failure, errorUpdatedAt: 2 }} />);
    expect(view.getByText("interrupted")).toBeTruthy();
    const success = { ...initial, dataUpdatedAt: 105_001, hasData: true };
    view.rerender(<Probe observation={success} />);
    act(() => fake.advance(2_999));
    expect(view.getByText("interrupted")).toBeTruthy();
    view.rerender(<Probe observation={{ ...success, errorUpdatedAt: 3, failureEligible: true }} />);
    act(() => fake.advance(1));
    expect(view.getByText("interrupted")).toBeTruthy();
    for (let recheck = 1; recheck <= 10; recheck++) {
      act(() => fake.advance(30_000));
      expect(calls).toBe(recheck + 1);
    }
    act(() => fake.advance(60_000));
    expect(calls).toBe(11);
    act(() => { view.getByRole("button", { name: "Retry" }).click(); });
    expect(calls).toBe(12);
    view.rerender(<Probe observation={{ ...initial, identity: "other\u0000US", dataUpdatedAt: 500_000 }} />);
    expect(view.getByText("clear")).toBeTruthy();
  });

  test("a successful confirmation never shows an indicator and a completed hold clears one", () => {
    const fake = fakeClock();
    let calls = 0;
    const initial: Observation = {
      identity: "owner\u0000US", fetchStatus: "idle", errorUpdatedAt: 0,
      dataUpdatedAt: 0, failureEligible: false, hasData: false,
    };
    function Probe({ observation }: { observation: Observation }) {
      const result = useInterruption(observation, true, async () => { calls += 1; }, fake.clock);
      return <output>{result.interruption?.kind ?? "clear"}</output>;
    }
    const view = render(<Probe observation={initial} />);
    view.rerender(<Probe observation={{ ...initial, errorUpdatedAt: 1, failureEligible: true }} />);
    act(() => fake.advance(5_000));
    expect(calls).toBe(1);
    view.rerender(<Probe observation={{ ...initial, dataUpdatedAt: 105_001, hasData: true }} />);
    expect(view.getByText("clear")).toBeTruthy();
    view.rerender(<Probe observation={{ ...initial, errorUpdatedAt: 2, failureEligible: true,
      dataUpdatedAt: 105_001, hasData: true }} />);
    act(() => fake.advance(5_000));
    view.rerender(<Probe observation={{ ...initial, errorUpdatedAt: 3, failureEligible: true,
      dataUpdatedAt: 105_001, hasData: true }} />);
    expect(view.getByText("interrupted")).toBeTruthy();
    view.rerender(<Probe observation={{ ...initial, errorUpdatedAt: 3, failureEligible: false,
      dataUpdatedAt: 110_001, hasData: true }} />);
    act(() => fake.advance(2_999));
    expect(view.getByText("interrupted")).toBeTruthy();
    act(() => fake.advance(1));
    expect(view.getByText("clear")).toBeTruthy();
  });

  test("reconnect refetch and retries share one in-flight balances GET", async () => {
    const fake = fakeClock();
    let calls = 0;
    let finish: ((value: typeof balancesSnapshotFixture) => void) | undefined;
    const fetchBalances: FetchBalances = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(balancesSnapshotFixture);
      return new Promise((resolve) => { finish = resolve; });
    };
    function Probe() {
      const balances = useBalances({
        subject: "subject-a", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453,
      }, "US", fetchBalances);
      const result = useInterruption(balances.observation, true, balances.retry, fake.clock);
      return <><output>{result.interruption?.kind ?? "clear"}</output>
        <output data-testid="balance-state">{balances.status}:{balances.observation.fetchStatus}</output>
        <button type="button" onClick={result.retry}>Retry</button></>;
    }
    const view = render(<Probe />);
    await waitFor(() => expect(view.getByTestId("balance-state").textContent).toBe("ready:idle"));
    expect(calls).toBe(1);
    act(() => onlineManager.setOnline(false));
    act(() => fake.advance(2_000));
    expect(view.getByText("offline")).toBeTruthy();
    act(() => onlineManager.setOnline(true));
    expect(view.getByText("interrupted")).toBeTruthy();
    await waitFor(() => expect(calls).toBe(2));
    act(() => {
      view.getByRole("button", { name: "Retry" }).click();
      view.getByRole("button", { name: "Retry" }).click();
    });
    expect(calls).toBe(2);
    await act(async () => { finish?.(balancesSnapshotFixture); });
    await waitFor(() => expect(view.getByTestId("balance-state").textContent).toBe("ready:idle"));
    expect(calls).toBe(2);
  });

  test("reconnecting before two foreground seconds never shows offline", () => {
    const fake = fakeClock();
    const observation: Observation = {
      identity: "owner\u0000US", fetchStatus: "idle", errorUpdatedAt: 0,
      dataUpdatedAt: 0, failureEligible: false, hasData: false,
    };
    function Probe() {
      const result = useInterruption(observation, true, async () => {}, fake.clock);
      return <output>{result.interruption?.kind ?? "clear"}</output>;
    }
    const view = render(<Probe />);
    act(() => { onlineManager.setOnline(false); fake.advance(1_500); onlineManager.setOnline(true); });
    act(() => fake.advance(5_000));
    expect(view.getByText("clear")).toBeTruthy();
  });

  test("foreground scheduler pauses offline delay while hidden", async () => {
    const fake = fakeClock();
    const observation: Observation = {
      identity: "owner\u0000US", fetchStatus: "idle", errorUpdatedAt: 0,
      dataUpdatedAt: 0, failureEligible: false, hasData: false,
    };
    function Probe() {
      const result = useInterruption(observation, true, async () => {}, fake.clock);
      return <output>{result.interruption?.kind ?? "clear"}</output>;
    }
    const view = render(<Probe />);
    act(() => { onlineManager.setOnline(false); fake.advance(1_000); });
    expect(view.getByText("clear")).toBeTruthy();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      fake.advance(10_000);
    });
    expect(view.getByText("clear")).toBeTruthy();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => fake.advance(999));
    expect(view.getByText("clear")).toBeTruthy();
    act(() => fake.advance(1));
    await waitFor(() => expect(view.getByText("offline")).toBeTruthy());
  });
});
