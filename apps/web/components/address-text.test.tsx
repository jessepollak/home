import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AddressField } = await import("./address-field");

const ADDRESS = "0x12a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac19fab";

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("AddressText and AddressField", () => {
  test("pastes into the one-line field and condenses a valid address when blurred", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => `  ${ADDRESS}  ` },
    });
    let value = "";
    const view = render(
      <AddressField
        id="to"
        value={value}
        onChange={(next) => {
          value = next;
          view.rerender(<AddressField id="to" value={value} onChange={(nextValue) => { value = nextValue; }} />);
        }}
      />,
    );
    const paste = view.getByRole("button", { name: "Paste address" });
    fireEvent.click(paste);
    await waitFor(() => expect(value).toBe(ADDRESS));
    view.rerender(
      <AddressField id="to" value={ADDRESS} onChange={() => {}} />,
    );
    expect((view.getByRole("textbox") as HTMLInputElement).value).toBe("0x12a4…c19fab");
  });

  test("a read-only field keeps focus and disables paste", () => {
    const view = render(<AddressField id="to" label="To" value={ADDRESS} onChange={() => {}} readOnly />);
    const input = view.getByRole("textbox", { name: "To" }) as HTMLInputElement;
    act(() => { input.focus(); });
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect((view.getByRole("button", { name: "Paste address" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
