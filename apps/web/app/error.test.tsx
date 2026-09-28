import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Component, StrictMode, type ReactNode } from "react";
import {
  CLIENT_ERROR_ENDPOINT,
  CLIENT_ERROR_MAX_REPORTS_PER_PAGE,
  installClientErrorReporting,
} from "@/client/observability/client-reporter";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { default: AppError } = await import("./error");

class SegmentBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <AppError error={this.state.error} retry={() => this.setState({ error: null })} />;
  }
}

let panelFails = true;
const thrown: Error[] = [];

function Panel() {
  if (panelFails) {
    const error = new TypeError("panel exploded");
    thrown.push(error);
    throw error;
  }
  return <p>Panel ready</p>;
}

function Page() {
  return (
    <StrictMode>
      <button type="button">Elsewhere</button>
      <SegmentBoundary><Panel /></SegmentBoundary>
    </StrictMode>
  );
}

const originalFetch = globalThis.fetch;
let reports: unknown[] = [];
let consoleError: ReturnType<typeof spyOn>;

beforeEach(() => {
  reports = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === CLIENT_ERROR_ENDPOINT) reports.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  consoleError = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  globalThis.fetch = originalFetch;
  panelFails = true;
  thrown.length = 0;
  window.__homeClientErrorReportingInstalled = false;
  window.__homeClientErrorReport = undefined;
});

describe("app error boundary", () => {
  test("a thrown render error shows the recovery UI, reports once, and Try again recovers", async () => {
    const view = render(<Page />);

    expect(view.getByRole("alert").textContent).toContain("This page couldn’t load.");
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({ name: "TypeError", message: "panel exploded", route: "/" });

    panelFails = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(view.getByText("Panel ready")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(reports).toHaveLength(1);
  });

  test("retries that keep failing stay within the per-page report limit", async () => {
    const view = render(<Page />);

    for (let attempt = 0; attempt < CLIENT_ERROR_MAX_REPORTS_PER_PAGE + 3; attempt += 1) {
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      expect(view.getByRole("alert")).toBeTruthy();
    }
    await Promise.resolve();

    expect(reports).toHaveLength(CLIENT_ERROR_MAX_REPORTS_PER_PAGE);
  });

  test("the window error listener does not report an error the boundary already reported", async () => {
    const addListener = spyOn(window, "addEventListener");
    installClientErrorReporting();
    const listeners = addListener.mock.calls.map(([type, listener]) => [type, listener] as const);
    addListener.mockRestore();
    try {
      render(<Page />);
      await waitFor(() => expect(reports).toHaveLength(1));

      window.dispatchEvent(new ErrorEvent("error", { error: thrown.at(-1), message: "panel exploded" }));
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("unrelated"), message: "unrelated" }));
      await Promise.resolve();

      expect(reports).toEqual([
        { name: "TypeError", message: "panel exploded", route: "/" },
        { name: "Error", message: "unrelated", route: "/" },
      ]);
    } finally {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    }
  });

  test("focus moves to Try again when an error appears, not on later re-renders", async () => {
    const view = render(<Page />);
    const tryAgain = view.getByRole("button", { name: "Try again" });
    await waitFor(() => expect(document.activeElement).toBe(tryAgain));

    const elsewhere = view.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    view.rerender(<Page />);
    expect(document.activeElement).toBe(elsewhere);

    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Try again" })),
    );
  });
});
