import "./dom-test-harness";

import { describe, expect, test } from "bun:test";
import type { BaseAccountLoginPhase } from "./cdp-client";

const { render, within } = await import("@testing-library/react");
const { BaseAccountOnlySignIn } = await import("./sign-in-base-account");

const noop = () => {};
const buttonRef = { current: null };

// Scope to the rendered container so shared-document leftovers from other
// test files cannot shadow this component's accessibility contract.
function renderBaseSignIn(phase: BaseAccountLoginPhase | null) {
  const view = render(
    <BaseAccountOnlySignIn buttonRef={buttonRef} phase={phase} onSignIn={noop} />,
  );
  return { view, scope: within(view.container) };
}

describe("Base Account sign-in live status", () => {
  test("idle keeps the stable action name and an empty persistent polite status node", () => {
    const { scope } = renderBaseSignIn(null);

    const button = scope.getByRole("button", { name: "Sign in with Base Account" });
    const liveStatus = scope.getByRole("status");
    expect(liveStatus.textContent).toBe("");
    expect(liveStatus.getAttribute("aria-live")).toBe("polite");
    expect(liveStatus.getAttribute("aria-atomic")).toBe("true");
    expect(button.contains(liveStatus)).toBe(false);
  });

  test("announces every phase through one same status node outside the button", () => {
    const phases: [BaseAccountLoginPhase, string][] = [
      ["connecting", "Connecting to your existing Base Account…"],
      ["signing", "Confirm sign-in in Base Account…"],
      ["verifying", "Finishing sign-in…"],
    ];
    const { view, scope } = renderBaseSignIn(null);
    const liveStatus = scope.getByRole("status");

    for (const [phase, message] of phases) {
      view.rerender(
        <BaseAccountOnlySignIn buttonRef={buttonRef} phase={phase} onSignIn={noop} />,
      );
      expect(scope.getAllByRole("status")).toHaveLength(1);
      expect(scope.getAllByRole("status")[0]).toBe(liveStatus);
      expect(liveStatus.textContent).toBe(message);
      const button = scope.getByRole("button", { name: "Sign in with Base Account" });
      expect(button.contains(liveStatus)).toBe(false);
      // The visible copy stays inline in the button, hidden from the name.
      expect(
        Array.from(button.children).some(
          (child) =>
            child.getAttribute("aria-hidden") === "true" &&
            child.textContent === message,
        ),
      ).toBe(true);
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
