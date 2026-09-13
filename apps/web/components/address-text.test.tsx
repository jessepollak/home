import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
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
    expect(paste.querySelector(".lucide-clipboard-paste")).toBeTruthy();
    expect(paste.querySelector(".lucide-copy")).toBeNull();
    fireEvent.click(paste);
    await waitFor(() => expect(value).toBe(ADDRESS));
    view.rerender(
      <AddressField id="to" value={ADDRESS} onChange={() => {}} />,
    );
    expect((view.getByRole("textbox") as HTMLInputElement).value).toBe("0x12a4…c19fab");
  });
});
