import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CoverageStatusPreview } = await import("./coverage-status-preview");

const props = {
  status: "Yellow" as const,
  accessibleName: "Yellow — Conditional issuer route",
  heading: "Example issuer route",
  details: [{ label: "Status", value: "Conditional" }],
};

afterEach(cleanup);

describe("CoverageStatusPreview", () => {
  test("keeps details hidden until its keyboard-focusable Base UI trigger opens", async () => {
    const view = render(<CoverageStatusPreview {...props} />);
    const trigger = view.getByRole("button", { name: props.accessibleName });
    expect(trigger.textContent).toBe("Yellow");
    expect(view.queryByText("Conditional")).toBeNull();

    fireEvent.focus(trigger);
    await waitFor(() => expect(view.getByText("Conditional")).toBeTruthy());
  });

  test("opens the detail card from a touch press", async () => {
    const view = render(<CoverageStatusPreview {...props} />);
    const trigger = view.getByRole("button", { name: props.accessibleName });
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    await waitFor(() => expect(view.getByText("Conditional")).toBeTruthy());
  });
});
