import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { CopyableValue } = await import("./copyable-value");

const VALUE = "0x12a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac19fab";
const DISPLAY = "0x12a4…c19fab";
const FULL_ADDRESS = "0x2211d1d0020daea8039e46cf1367962070d77da9";

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

  test("reveals a condensed address, copies the full value, and announces success", async () => {
    let copied = "";
    withClipboard(async (value: string) => { copied = value; });
    const view = render(
      <CopyableValue value={FULL_ADDRESS} presentation="reveal" valueKind="address" />,
    );
    const shown = "0x2211…d77da9";
    const trigger = view.getByRole("button", { name: `Show full address ${shown}` });
    expect(trigger.textContent).toBe(shown);
    expect(trigger.title).toBe(FULL_ADDRESS);
    expect(view.queryByLabelText(`Full address ${FULL_ADDRESS}`)).toBeNull();

    fireEvent.click(trigger);
    const fullValue = await view.findByLabelText(`Full address ${FULL_ADDRESS}`);
    expect(fullValue.tagName).toBe("CODE");
    expect(fullValue.textContent).toBe(FULL_ADDRESS);
    expect(fullValue.getAttribute("tabindex")).toBe("0");
    fireEvent.click(view.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copied).toBe(FULL_ADDRESS));
    expect(view.getByRole("button", { name: "Copied" }).textContent).toBe("Copied");
    expect(view.getByRole("dialog", { name: "Full address" }).querySelector('[aria-live="polite"]')?.textContent).toBe("Copied");
  });

  test("reveal respects an explicit condensed display", () => {
    const view = render(<CopyableValue value={FULL_ADDRESS} display={DISPLAY} presentation="reveal" valueKind="address" />);
    expect(view.getByRole("button", { name: `Show full address ${DISPLAY}` }).textContent).toBe(DISPLAY);
  });

  test.each([
    ["denied", async () => { throw new Error("denied"); }, "Clipboard access failed."],
    ["unavailable", null, "Clipboard access is unavailable."],
  ])("keeps the full address selectable when copying is %s", async (_state, writeText, message) => {
    if (writeText) withClipboard(writeText);
    const view = render(<CopyableValue value={FULL_ADDRESS} presentation="reveal" valueKind="address" />);
    fireEvent.click(view.getByRole("button", { name: "Show full address 0x2211…d77da9" }));
    fireEvent.click(await view.findByRole("button", { name: "Copy address" }));

    const alert = await view.findByRole("alert");
    expect(alert.textContent).toBe(`${message} Select the full address above to copy it.`);
    const fullValue = view.getByLabelText(`Full address ${FULL_ADDRESS}`);
    expect(fullValue.textContent).toBe(FULL_ADDRESS);
    fullValue.focus();
    expect(document.activeElement).toBe(fullValue);
  });

  test("Escape closes the reveal and restores focus to its trigger", async () => {
    const view = render(<CopyableValue value={FULL_ADDRESS} presentation="reveal" valueKind="address" />);
    const trigger = view.getByRole("button", { name: "Show full address 0x2211…d77da9" });
    fireEvent.click(trigger);
    expect(await view.findByLabelText(`Full address ${FULL_ADDRESS}`)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("renders the compact presentation with a title and copy icon", () => {
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} presentation="compact" valueKind="address" />);
    const control = view.getByRole("button", { name: `Copy ${DISPLAY}` });

    expect(control.title).toBe(VALUE);
    expect(control.querySelector(".lucide-copy")).toBeTruthy();
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
