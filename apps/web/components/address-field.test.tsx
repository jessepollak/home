import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AddressField } = await import("./address-field");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

test("a rejected clipboard read leaves the address unchanged and editable", async () => {
  let reads = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: async () => { reads += 1; throw new Error("clipboard denied"); } },
  });
  function Harness() {
    const [value, setValue] = useState("original");
    return <AddressField id="address" value={value} onChange={setValue} />;
  }
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const view = render(<Harness />);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Paste address" }));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    expect(reads).toBe(1);
    expect(unhandled).toEqual([]);
    const input = view.getByRole("textbox", { name: "Address" });
    if (!(input instanceof HTMLInputElement)) throw new Error("Address field must be an input.");
    expect(input.value).toBe("original");
    fireEvent.change(input, { target: { value: "manual address" } });
    expect(input.value).toBe("manual address");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
