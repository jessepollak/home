import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { CopyableValue } = await import("./copyable-value");

const VALUE = "0x12a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac19fab";
const DISPLAY = "0x12a4…c19fab";
const css = readFileSync(resolve(import.meta.dir, "copyable-value.module.css"), "utf8");

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

  test("copies a full transaction id while showing its condensed hash", async () => {
    let copied = "";
    const transactionId = `0x${"ab".repeat(32)}`;
    const condensed = `${transactionId.slice(0, 10)}…${transactionId.slice(-8)}`;
    withClipboard(async (value: string) => {
      copied = value;
    });
    const view = render(
      <CopyableValue
        value={transactionId}
        display={condensed}
        valueKind="transaction ID"
      />,
    );

    fireEvent.click(view.getByRole("button", { name: `Copy ${condensed}` }));
    await waitFor(() => expect(copied).toBe(transactionId));
    expect(view.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  test("labels the fallback and error with the transaction-ID noun", async () => {
    const transactionId = `0x${"ab".repeat(32)}`;
    const condensed = `${transactionId.slice(0, 10)}…${transactionId.slice(-8)}`;
    const view = render(
      <CopyableValue
        value={transactionId}
        display={condensed}
        valueKind="transaction ID"
      />,
    );

    fireEvent.click(view.getByRole("button", { name: `Copy ${condensed}` }));
    expect(view.queryByRole("button", { name: "Copied" })).toBeNull();
    expect((await view.findByRole("alert")).textContent).toContain(
      "full transaction ID below",
    );
    expect(view.getByLabelText(`Full transaction ID ${transactionId}`).textContent).toBe(
      transactionId,
    );
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

  test("clears the confirmation after the reset timer", async () => {
    jest.useFakeTimers();
    withClipboard(async () => {});
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} valueKind="address" />);

    fireEvent.click(view.getByRole("button", { name: `Copy ${DISPLAY}` }));
    expect(await view.findByRole("button", { name: "Copied" })).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    expect(view.getByRole("button", { name: `Copy ${DISPLAY}` })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
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

  test("is a native button with focus, touch, and reduced-motion support", () => {
    const view = render(<CopyableValue value={VALUE} display={DISPLAY} valueKind="address" />);
    const control = view.getByRole("button", { name: `Copy ${DISPLAY}` });
    expect(control.tagName.toLowerCase()).toBe("button");
    expect(control.getAttribute("type")).toBe("button");

    expect(css).toContain(".text:focus-visible");
    expect(css).toContain("touch-action: manipulation");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("user-select: text");
  });
});
