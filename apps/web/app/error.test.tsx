import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Component, StrictMode, type ReactNode } from "react";
import { CLIENT_ERROR_ENDPOINT } from "@/client/observability/client-reporter";

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

function Panel() {
  if (panelFails) throw new TypeError("panel exploded");
  return <p>Panel ready</p>;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  panelFails = true;
});

describe("app error boundary", () => {
  test("a thrown render error shows the recovery UI, reports once, and Try again recovers", async () => {
    const reports: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === CLIENT_ERROR_ENDPOINT) reports.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    const view = render(<StrictMode><SegmentBoundary><Panel /></SegmentBoundary></StrictMode>);

    expect(view.getByRole("alert").textContent).toContain("This page couldn’t load.");
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({ name: "TypeError", message: "panel exploded", route: "/" });

    panelFails = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(view.getByText("Panel ready")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(reports).toHaveLength(1);
    consoleError.mockRestore();
  });
});
