import "./dom-test-harness";

import { describe, expect, test } from "bun:test";
import type { BaseAccountLoginPhase } from "./cdp-client";

const { render, within } = await import("@testing-library/react");
const { BaseAccountOnlySignIn } = await import("./sign-in-base-account");

const noop = () => {};
const buttonRef = { current: null };

const phaseMessages: Record<BaseAccountLoginPhase, string> = {
  connecting: "Connecting to your existing Base Account…",
  signing: "Confirm sign-in in Base Account…",
  verifying: "Finishing sign-in…",
};

// Scope to the rendered container so shared-document leftovers from other
// test files cannot shadow this component's accessibility contract.
function renderBaseSignIn(phase: BaseAccountLoginPhase | null) {
  const view = render(
    <BaseAccountOnlySignIn buttonRef={buttonRef} phase={phase} onSignIn={noop} />,
  );
  return { view, scope: within(view.container) };
}

describe("Base Account sign-in live status", () => {
  test("idle keeps the stable action name with an empty live status node", () => {
    const { scope } = renderBaseSignIn(null);

    expect(scope.getByRole("button", { name: "Sign in with Base Account" })).toBeTruthy();
    const liveStatus = scope.getByRole("status");
    expect(liveStatus.textContent).toBe("");
    expect(liveStatus.getAttribute("aria-live")).toBe("polite");
    expect(liveStatus.getAttribute("aria-atomic")).toBe("true");
    for (const message of Object.values(phaseMessages)) {
      expect(scope.queryAllByText(message)).toEqual([]);
    }
  });

  test.each(["connecting", "signing", "verifying"] as const)(
    "exposes the %s phase exactly once through the live status node",
    (phase) => {
      const { scope } = renderBaseSignIn(phase);

      const button = scope.getByRole("button", { name: "Sign in with Base Account" });
      expect(button).toBeTruthy();
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.getAttribute("aria-disabled")).toBe("true");

      const statuses = scope.getAllByRole("status");
      expect(statuses).toHaveLength(1);
      const [liveStatus] = statuses;
      expect(liveStatus.textContent).toBe(phaseMessages[phase]);
      expect(button.contains(liveStatus)).toBe(false);
      // The visible progress copy stays in the button, hidden from the name.
      expect(button.textContent).toContain(phaseMessages[phase]);
    },
  );

  test("transitions update one persistent status node without remounting it", () => {
    const { view, scope } = renderBaseSignIn(null);
    const liveStatus = scope.getByRole("status");

    for (const phase of ["connecting", "signing", "verifying"] as const) {
      view.rerender(
        <BaseAccountOnlySignIn buttonRef={buttonRef} phase={phase} onSignIn={noop} />,
      );
      expect(scope.getAllByRole("status")).toHaveLength(1);
      expect(scope.getAllByRole("status")[0]).toBe(liveStatus);
      expect(liveStatus.textContent).toBe(phaseMessages[phase]);
      expect(
        scope.getByRole("button", { name: "Sign in with Base Account" }),
      ).toBeTruthy();
    }

    view.rerender(
      <BaseAccountOnlySignIn buttonRef={buttonRef} phase={null} onSignIn={noop} />,
    );
    expect(liveStatus.textContent).toBe("");
    expect(
      scope.getByRole("button", { name: "Sign in with Base Account" }),
    ).toBeTruthy();
  });
});
