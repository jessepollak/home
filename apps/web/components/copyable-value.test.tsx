import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { CopyableValue } = await import("./copyable-value");

const VALUE = "0x12a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac19fab";
const DISPLAY = "0x12a4…c19fab";

function withClipboard(writeText: (value: string) => Promise<unknown>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("CopyableValue", () => {
  test("copies the full value while showing the condensed display and confirms only after success", async () => {
    let copied = "";
    withClipboard(async (value: string) => {
      copied = value;
    });
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} valueKind="address" />);

    const control = view.getByRole("button", { name: `Copy ${DISPLAY}` });
    expect(control.textContent).toBe(DISPLAY);
    expect(control.title).toBe(VALUE);

    fireEvent.click(control);
    await waitFor(() => expect(copied).toBe(VALUE));
    expect(view.getByRole("button", { name: "Copied" }).textContent).toBe("Copied");
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toBe("Copied");
  });

  test("exposes the selectable full value and a truthful error when clipboard is unavailable", async () => {
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} valueKind="address" />);
    fireEvent.click(view.getByRole("button", { name: `Copy ${DISPLAY}` }));

    expect(view.queryByRole("button", { name: "Copied" })).toBeNull();
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("Clipboard access is unavailable");
    expect(alert.textContent).toContain("Select and copy the full address below.");

    const fallback = view.getByLabelText(`Full address ${VALUE}`);
    expect(fallback.textContent).toBe(VALUE);
    expect(fallback.getAttribute("tabindex")).toBe("0");
  });

  test("reports a denied write separately from missing clipboard access", async () => {
    withClipboard(async () => {
      throw new Error("denied");
    });
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} valueKind="address" />);
    fireEvent.click(view.getByRole("button", { name: `Copy ${DISPLAY}` }));

    expect(view.queryByRole("button", { name: "Copied" })).toBeNull();
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("Clipboard access failed");
    expect(view.getByLabelText(`Full address ${VALUE}`).textContent).toBe(VALUE);
  });

  test("clears a stale confirmation when the value or owner changes", async () => {
    withClipboard(async () => {});
    const view = render(
      <CopyableValue value={VALUE} display={DISPLAY} valueKind="address" resetKey="owner-a" />,
    );

    fireEvent.click(view.getByRole("button", { name: `Copy ${DISPLAY}` }));
    expect(await view.findByRole("button", { name: "Copied" })).toBeTruthy();

    view.rerender(
      <CopyableValue
        value="0x2222222222222222222222222222222222222222"
        display="0x2222…222222"
        valueKind="address"
        resetKey="owner-a"
      />,
    );
    expect(view.getByRole("button", { name: "Copy 0x2222…222222" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Copy 0x2222…222222" }));
    expect(await view.findByRole("button", { name: "Copied" })).toBeTruthy();

    view.rerender(
      <CopyableValue
        value="0x2222222222222222222222222222222222222222"
        display="0x2222…222222"
        valueKind="address"
        resetKey="owner-b"
      />,
    );
    expect(view.getByRole("button", { name: "Copy 0x2222…222222" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Copied" })).toBeNull();
  });


});
