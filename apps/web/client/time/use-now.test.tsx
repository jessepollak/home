import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { useNow } from "./use-now";
const { act, cleanup, render } = await import("@testing-library/react");

const noDeadline = () => null;

function Clock({ refreshKey, nextDeadline = noDeadline, now }: {
  refreshKey: string;
  nextDeadline?: (value: number) => number | null;
  now: () => number;
}) {
  return <output>{useNow(refreshKey, nextDeadline, now)}</output>;
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useNow", () => {
  test("keeps a stable snapshot until its refresh key changes", () => {
    let time = 100;
    const now = () => time;
    const view = render(<Clock refreshKey="first" now={now} />);
    expect(view.container.textContent).toBe("100");
    time = 200;
    view.rerender(<Clock refreshKey="first" now={now} />);
    expect(view.container.textContent).toBe("100");
    view.rerender(<Clock refreshKey="second" now={now} />);
    expect(view.container.textContent).toBe("200");
  });

  test("wakes at successive deadlines and stops after the final deadline", () => {
    jest.useFakeTimers();
    let time = 100;
    const now = jest.fn(() => time);
    const nextDeadline = (value: number) => value < 200 ? 200 : value < 350 ? 350 : null;
    const view = render(<Clock refreshKey="rates" now={now} nextDeadline={nextDeadline} />);
    expect(view.container.textContent).toBe("100");
    expect(jest.getTimerCount()).toBe(1);
    time = 199;
    void act(() => jest.advanceTimersByTime(99));
    expect(view.container.textContent).toBe("100");
    time = 200;
    void act(() => jest.advanceTimersByTime(1));
    expect(view.container.textContent).toBe("200");
    time = 350;
    void act(() => jest.advanceTimersByTime(150));
    expect(view.container.textContent).toBe("350");
    const reads = now.mock.calls.length;
    time = 500;
    void act(() => jest.advanceTimersByTime(150));
    expect(view.container.textContent).toBe("350");
    expect(now).toHaveBeenCalledTimes(reads);
  });

  test("does not publish a future time when the clock is late to a deadline", () => {
    jest.useFakeTimers();
    let time = 100;
    const now = () => time;
    const view = render(<Clock refreshKey="rates" now={now} nextDeadline={(value) => value < 200 ? 200 : null} />);
    expect(view.container.textContent).toBe("100");
    expect(jest.getTimerCount()).toBe(1);
    time = 150;
    void act(() => jest.advanceTimersByTime(100));
    expect(view.container.textContent).toBe("100");
    expect(jest.getTimerCount()).toBe(1);
    time = 200;
    void act(() => jest.advanceTimersByTime(50));
    expect(view.container.textContent).toBe("200");
  });
  test("cleans up the scheduled deadline on unmount", () => {
    jest.useFakeTimers();
    const now = jest.fn(() => 100);
    const view = render(<Clock refreshKey="rates" now={now} nextDeadline={() => 200} />);
    expect(jest.getTimerCount()).toBe(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
    void act(() => jest.advanceTimersByTime(100));
    expect(now).toHaveBeenCalledTimes(2);
  });
});
