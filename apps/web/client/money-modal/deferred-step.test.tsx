import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import type { ComponentType } from "react";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { deferStep } = await import("./deferred-sheet");

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("deferStep", () => {
  test("does not load before render or preload and replaces fallback after loading", async () => {
    let loads = 0;
    let resolve!: (component: ComponentType<{ label: string }>) => void;
    const Step = deferStep<{ label: string }>(() => {
      loads += 1;
      return new Promise((complete) => { resolve = complete; });
    });
    expect(loads).toBe(0);
    render(<Step label="Loaded step" fallback={({ failed }) => <span>{failed ? "Failed" : "Loading step"}</span>} />);
    expect(page().getByText("Loading step")).toBeTruthy();
    expect(loads).toBe(1);
    await act(async () => resolve(({ label }) => <div>{label}</div>));
    expect(page().getByText("Loaded step")).toBeTruthy();
    expect(page().queryByText("Loading step")).toBeNull();
  });

  test("automatic failures expose retry, then manual retry shows loading and renders content", async () => {
    jest.useFakeTimers();
    let loads = 0;
    let completeRetry!: (component: ComponentType<{ label: string }>) => void;
    const Step = deferStep<{ label: string }>(() => {
      loads += 1;
      if (loads <= 3) return Promise.reject(new Error("chunk failed"));
      return new Promise((resolve) => { completeRetry = resolve; });
    });
    render(<Step label="Recovered" fallback={({ failed, retry }) => failed ? <button type="button" onClick={retry}>Retry</button> : <span>Loading step</span>} />);
    await act(async () => { await Promise.resolve(); });
    expect(loads).toBe(1);
    expect(page().getByText("Loading step")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1_000); await Promise.resolve(); });
    expect(loads).toBe(2);
    await act(async () => { jest.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(loads).toBe(3);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Retry" })));
    expect(page().getByText("Loading step")).toBeTruthy();
    await act(async () => completeRetry(({ label }) => <div>{label}</div>));
    expect(page().getByText("Recovered")).toBeTruthy();
    expect(loads).toBe(4);
  });

  test("preload-before-render mounts loaded content without fallback", async () => {
    let loads = 0;
    const Step = deferStep<{ label: string }>(async () => {
      loads += 1;
      return ({ label }) => <div>{label}</div>;
    });
    await Step.preload();
    render(<Step label="Preloaded" fallback={() => <span>Fallback</span>} />);
    expect(page().getByText("Preloaded")).toBeTruthy();
    expect(page().queryByText("Fallback")).toBeNull();
    expect(loads).toBe(1);
  });
});
