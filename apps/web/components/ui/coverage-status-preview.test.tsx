import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CoverageStatusPreview } = await import("./coverage-status-preview");

const props = {
  status: "Yellow" as const,
  accessibleName: "Yellow — Conditional issuer route",
  heading: "Example issuer route",
  details: [
    { label: "Status", value: "Conditional" },
    { label: "Evidence", value: "Checked 2026-03-19", href: "https://example.com/evidence" },
  ],
};

afterEach(cleanup);

describe("CoverageStatusPreview", () => {
  test("opens an ARIA-related dialog on click and allows its evidence link to receive focus", async () => {
    const view = render(<CoverageStatusPreview {...props} />);
    const trigger = view.getByRole("button", { name: props.accessibleName });
    expect(trigger.textContent).toBe("");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);

    const popup = await view.findByRole("dialog");
    expect(popup.textContent).toContain("Traffic colorYellow");
    expect(popup.textContent).toContain("StatusConditional");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(popup.id);
    expect(popup.getAttribute("aria-labelledby")).toBeTruthy();
    const evidence = view.getByRole("link", { name: "Checked 2026-03-19" });
    evidence.focus();
    expect(document.activeElement).toBe(evidence);
  });

  test("opens from the keyboard and exposes the hollow indicator variant", async () => {
    const view = render(<CoverageStatusPreview {...props} indicatorVariant="hollow" />);
    const trigger = view.getByRole("button", { name: props.accessibleName });
    expect(trigger.getAttribute("data-indicator")).toBe("hollow");

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.click(trigger, { detail: 0 });
    fireEvent.keyUp(trigger, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
  });
});
