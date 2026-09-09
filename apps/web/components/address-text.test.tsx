import "./../features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AddressText } = await import("./address-text");
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
  test("shows first6…last6 and copies the full address", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });
    const view = render(<AddressText address={ADDRESS} />);
    expect(view.getByRole("button", { name: "Copy 0x12a4…c19fab" }).textContent).toBe(
      "0x12a4…c19fab",
    );
    fireEvent.click(view.getByRole("button", { name: "Copy 0x12a4…c19fab" }));
    await waitFor(() => expect(copied).toBe(ADDRESS));
    expect(view.getByRole("button", { name: "Copied" }).textContent).toBe("Copied");
  });

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
    fireEvent.click(view.getByRole("button", { name: "Paste address" }));
    await waitFor(() => expect(value).toBe(ADDRESS));
    view.rerender(
      <AddressField id="to" value={ADDRESS} onChange={() => {}} />,
    );
    expect((view.getByRole("textbox") as HTMLInputElement).value).toBe("0x12a4…c19fab");
  });
});
