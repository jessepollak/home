import "../account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { act, render, renderHook } from "@testing-library/react";
import { MoneyConfirmFooter } from "@/client/money-modal";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { ReactNode } from "react";
import { ExpirySchedulerContext, useReactiveExpiry, type ExpiryScheduler } from "./expiry";

describe("reactive expiry", () => {
  test("uses the provided scheduler for initial state, timers, and rechecks", () => {
    let now = 100;
    let nextId = 0;
    const timers = new Map<number, { callback: () => void; ms: number }>();
    const scheduler: ExpiryScheduler = {
      now: () => now,
      setTimeout(callback, ms) {
        const id = ++nextId;
        timers.set(id, { callback, ms });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    };
    const deadline = new Date(150).toISOString();
    const wrapper = ({ children }: { children: ReactNode }) => <ExpirySchedulerContext value={scheduler}>{children}</ExpirySchedulerContext>;
    const { result, unmount } = renderHook(() => useReactiveExpiry(deadline), { wrapper });

    expect(result.current.expired).toBe(false);
    expect(result.current.recheckExpired()).toBe(false);
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([50]);

    now = 151;
    const runNext = () => {
      const [id, timer] = [...timers][0]!;
      timers.delete(id);
      timer.callback();
    };
    act(runNext);
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([0]);
    act(runNext);
    expect(result.current.expired).toBe(true);
    act(() => { expect(result.current.recheckExpired()).toBe(true); });
    unmount();
    expect(timers.size).toBe(0);

    const expiredOnMount = renderHook(() => useReactiveExpiry(deadline), { wrapper });
    expect(expiredOnMount.result.current.expired).toBe(true);
  });

  test("the confirm footer reads the same provided clock as its surface", () => {
    const scheduler: ExpiryScheduler = { now: () => Date.parse("2000-01-01T00:00:00.000Z"), setTimeout: () => 0, clearTimeout: () => {} };
    const action: PreparedMoneyAction = {
      id: "prepared-1", kind: "send", title: "Send", calls: [], amounts: [], warnings: [],
      owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
      createdAt: "1999-12-31T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z",
    };
    const view = render(<ExpirySchedulerContext value={scheduler}><MoneyConfirmFooter action={action} primaryLabel="Send" /></ExpirySchedulerContext>);
    expect(view.getByRole("button", { name: "Send" }).getAttribute("data-money-action-id")).toBe("prepared-1");
    view.unmount();
  });
});
