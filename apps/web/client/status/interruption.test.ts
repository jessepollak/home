import { describe, expect, test } from "bun:test";
import { initialInterruptionState, reduceInterruption, visibleInterruption } from "./interruption";

type Observation = Extract<Parameters<typeof reduceInterruption>[1], { type: "observe" }>["observation"];
const base: Observation = {
  identity: "owner\u0000US", fetchStatus: "idle", errorUpdatedAt: 0,
  dataUpdatedAt: 0, failureEligible: false, hasData: false,
};
function fixture() {
  let state = initialInterruptionState();
  let now = 0;
  let wallNow = 100_000;
  let online = true;
  let visible = true;
  let observation = { ...base };
  const send = (event: Parameters<typeof reduceInterruption>[1]) => {
    state = reduceInterruption(state, event);
    return visibleInterruption(state);
  };
  return {
    get state() { return state; },
    get now() { return now; },
    start() { return send({ type: "observe", observation, enabled: true, now, wallNow, online }); },
    step(ms: number) { if (visible) now += ms; wallNow += ms; return send({ type: "tick", now }); },
    visibility(value: boolean) { visible = value; return send({ type: "tick", now }); },
    connect(value: boolean) { online = value; return send({ type: "connectivity", online, now, wallNow }); },
    read(update: Partial<Observation>) {
      observation = { ...observation, ...update };
      return send({ type: "observe", observation, enabled: true, now, wallNow, online });
    },
    retry() { return send({ type: "retry" }); },
  };
}
function interrupted() {
  const f = fixture();
  f.start();
  f.read({ errorUpdatedAt: 1, failureEligible: true });
  f.step(5_000);
  f.read({ errorUpdatedAt: 2 });
  expect(visibleInterruption(f.state)).toBe("interrupted");
  return f;
}

describe("foreground interruption transitions", () => {
  test("offline requires two continuous foreground seconds", () => {
    const f = fixture(); f.start();
    expect(f.connect(false)).toBeNull();
    expect(f.step(1_999)).toBeNull();
    expect(f.step(1)).toBe("offline");
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.requests).toBe(1);
    const short = fixture(); short.start(); short.connect(false); short.step(1_500);
    expect(short.connect(true)).toBeNull();
    expect(short.step(10_000)).toBeNull();
  });

  test("an existing interruption stays visible during an unconfirmed offline interval", () => {
    const f = interrupted();
    expect(f.connect(false)).toBe("interrupted");
    expect(f.step(1_999)).toBe("interrupted");
    expect(f.step(1)).toBe("offline");
    expect(f.connect(true)).toBe("interrupted");
  });

  test("success while offline waits for a reconnect recovery hold", () => {
    const f = interrupted();
    expect(f.connect(false)).toBe("interrupted");
    expect(f.step(2_000)).toBe("offline");
    expect(f.read({ dataUpdatedAt: 107_001, hasData: true })).toBe("offline");
    expect(f.step(10_000)).toBe("offline");
    expect(f.state.phase).toBe("offline");
    expect(f.state.requests).toBe(1);
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.requests).toBe(1);
    expect(f.step(2_999)).toBe("interrupted");
    expect(f.step(1)).toBeNull();
  });

  test("reconnect without an offline success requests a verification read", () => {
    const f = interrupted();
    f.connect(false);
    expect(f.step(2_000)).toBe("offline");
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.requests).toBe(2);
    expect(f.step(3_000)).toBe("interrupted");
  });

  test("success during offline debounce recovers an interrupted incident after reconnect", () => {
    const f = interrupted();
    expect(f.connect(false)).toBe("interrupted");
    expect(f.read({ dataUpdatedAt: 105_001, hasData: true })).toBe("interrupted");
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.requests).toBe(1);
    expect(f.step(2_999)).toBe("interrupted");
    expect(f.step(1)).toBeNull();
  });

  test("success during offline debounce clears transient on reconnect", () => {
    const f = fixture(); f.start();
    f.read({ errorUpdatedAt: 1, failureEligible: true });
    expect(f.connect(false)).toBeNull();
    expect(f.read({ dataUpdatedAt: 100_001, hasData: true })).toBeNull();
    expect(f.connect(true)).toBeNull();
    expect(f.state.phase).toBe("healthy");
    expect(f.step(5_000)).toBeNull();
    expect(f.state.requests).toBe(0);
  });

  test("success during a healthy offline debounce starts recovery on reconnect", () => {
    const f = fixture(); f.start();
    expect(f.connect(false)).toBeNull();
    expect(f.read({ dataUpdatedAt: 100_001, hasData: true })).toBeNull();
    expect(f.step(2_000)).toBe("offline");
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.requests).toBe(0);
    expect(f.step(2_999)).toBe("interrupted");
    expect(f.step(1)).toBeNull();
  });

  test("success during a healthy offline debounce is dropped by a short reconnect", () => {
    const f = fixture(); f.start();
    f.connect(false);
    f.read({ dataUpdatedAt: 100_001, hasData: true });
    expect(f.connect(true)).toBeNull();
    expect(f.state.deferredSuccess).toBe(false);
    expect(f.step(10_000)).toBeNull();
  });

  test("failure during a deferred-success recovery hold cancels the clear", () => {
    const f = interrupted();
    f.connect(false);
    f.step(2_000);
    f.read({ dataUpdatedAt: 107_001, hasData: true });
    expect(f.connect(true)).toBe("interrupted");
    expect(f.step(1_500)).toBe("interrupted");
    expect(f.read({ errorUpdatedAt: 3 })).toBe("interrupted");
    expect(f.state.phase).toBe("interrupted");
    expect(f.step(1_500)).toBe("interrupted");
  });

  test("hidden wall time does not advance foreground timers", () => {
    const f = fixture(); f.start(); f.connect(false);
    expect(f.step(1_000)).toBeNull();
    f.visibility(false);
    expect(f.step(10_000)).toBeNull();
    f.visibility(true);
    expect(f.step(999)).toBeNull();
    expect(f.step(1)).toBe("offline");
  });

  test("confirmation is requested once at five seconds and only failure shows status", () => {
    const f = fixture(); f.start();
    f.read({ errorUpdatedAt: 1, failureEligible: true });
    expect(f.step(4_999)).toBeNull();
    expect(f.state.requests).toBe(0);
    expect(f.step(1)).toBeNull();
    expect(f.state.requests).toBe(1);
    f.step(10_000);
    expect(f.state.requests).toBe(1);
    expect(f.read({ errorUpdatedAt: 2 })).toBe("interrupted");
    const recovered = fixture(); recovered.start();
    recovered.read({ errorUpdatedAt: 1, failureEligible: true });
    recovered.step(5_000);
    expect(recovered.read({ dataUpdatedAt: 105_001, hasData: true })).toBeNull();
    expect(recovered.step(90_000)).toBeNull();
  });

  test("an in-flight confirmation uses its result rather than requesting another read", () => {
    const f = fixture(); f.start();
    f.read({ errorUpdatedAt: 1, failureEligible: true, fetchStatus: "fetching" });
    expect(f.step(5_000)).toBeNull();
    expect(f.state.confirmationRequested).toBe(true);
    expect(f.state.requests).toBe(0);
    expect(f.read({ fetchStatus: "idle", errorUpdatedAt: 2 })).toBe("interrupted");
  });

  test("an in-flight recheck waits for the fetch to settle before restarting its cadence", () => {
    const f = interrupted();
    expect(f.read({ fetchStatus: "fetching" })).toBe("interrupted");
    expect(f.step(11 * 60_000)).toBe("interrupted");
    expect(f.state.awaitingSettle).toBe(true);
    expect(f.state.rechecks).toBe(0);
    expect(f.state.requests).toBe(1);
    expect(f.read({ fetchStatus: "idle", errorUpdatedAt: 3 })).toBe("interrupted");
    expect(f.state.awaitingSettle).toBe(false);
    expect(f.step(29_999)).toBe("interrupted");
    expect(f.state.rechecks).toBe(0);
    expect(f.step(1)).toBe("interrupted");
    expect(f.state.rechecks).toBe(1);
    expect(f.state.requests).toBe(2);
  });

  test("a successful in-flight recheck enters recovery hold rather than scheduling another check", () => {
    const f = interrupted();
    f.read({ fetchStatus: "fetching" });
    f.step(30_000);
    expect(f.read({ fetchStatus: "idle", dataUpdatedAt: 135_001, hasData: true })).toBe("interrupted");
    expect(f.state.phase).toBe("recovery-hold");
    expect(f.state.awaitingSettle).toBe(false);
    expect(f.state.rechecks).toBe(0);
    expect(f.step(2_999)).toBe("interrupted");
    expect(f.step(1)).toBeNull();
  });

  test("a pending recheck remains suspended across a short offline interval", () => {
    const f = interrupted();
    f.read({ fetchStatus: "fetching" });
    f.step(30_000);
    expect(f.state.awaitingSettle).toBe(true);
    f.connect(false);
    expect(f.connect(true)).toBe("interrupted");
    expect(f.state.awaitingSettle).toBe(true);
    expect(f.state.deadline).toBeNull();
    expect(f.read({ fetchStatus: "idle", errorUpdatedAt: 3 })).toBe("interrupted");
    expect(f.step(30_000)).toBe("interrupted");
    expect(f.state.rechecks).toBe(1);
  });

  test("ten 30-second rechecks exhaust the cap but manual Retry continues", () => {
    const f = interrupted();
    for (let count = 1; count <= 10; count++) {
      expect(f.step(29_999)).toBe("interrupted");
      expect(f.state.requests).toBe(count);
      f.step(1);
      expect(f.state.requests).toBe(count + 1);
    }
    f.step(300_000);
    expect(f.state.requests).toBe(11);
    f.retry();
    expect(f.state.requests).toBe(12);
  });

  test("recovery hold is silent until three seconds and eligible failure cancels it", () => {
    const f = interrupted();
    expect(f.read({ dataUpdatedAt: 105_001, hasData: true })).toBe("interrupted");
    expect(f.step(2_999)).toBe("interrupted");
    expect(f.step(1)).toBeNull();
    const failed = interrupted();
    failed.read({ dataUpdatedAt: 105_001, hasData: true });
    failed.step(1_500);
    expect(failed.read({ errorUpdatedAt: 3 })).toBe("interrupted");
    expect(failed.step(1_500)).toBe("interrupted");
  });

  test("connectivity, old cache data, and another identity cannot recover an incident", () => {
    const f = interrupted();
    f.connect(false); f.connect(true);
    expect(visibleInterruption(f.state)).toBe("interrupted");
    expect(f.state.requests).toBe(1);
    expect(f.read({ dataUpdatedAt: 100_000, hasData: true })).toBe("interrupted");
    expect(f.read({ fetchStatus: "paused", dataUpdatedAt: 105_001 })).toBe("interrupted");
    expect(f.read({ dataUpdatedAt: 106_000, hasData: true, identity: "other\u0000US" })).toBeNull();
    expect(f.state.phase).toBe("healthy");
  });

  test.each(["stale snapshot", "partial coverage", "missing quote", "isolated provider failure"])(
    "%s is a successful read, not an interruption", () => {
      const f = fixture(); f.start();
      expect(f.read({ dataUpdatedAt: 100_001, hasData: true })).toBeNull();
      expect(f.step(120_000)).toBeNull();
    },
  );

  test.each(["401", "403", "deployment access", "abort", "parse"])(
    "%s is not an eligible failure", () => {
      const f = fixture(); f.start();
      expect(f.read({ errorUpdatedAt: 1, failureEligible: false })).toBeNull();
      expect(f.step(120_000)).toBeNull();
    },
  );

  test("unverified or changed owner discards an open incident", () => {
    const f = interrupted();
    expect(reduceInterruption(f.state, {
      type: "observe", enabled: false, observation: base, now: f.now, wallNow: 105_000, online: true,
    }).phase).toBe("healthy");
    expect(f.read({ identity: "owner\u0000CA" })).toBeNull();
    expect(f.state.rechecks).toBe(0);
  });
});
