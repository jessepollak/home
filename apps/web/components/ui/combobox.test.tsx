import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { Combobox, ComboboxInput } from "./combobox";

const { cleanup, render } = await import("@testing-library/react");

afterEach(cleanup);

test.each([
  { ariaLabel: "Currency", triggerLabel: undefined, expectedName: "Currency options" },
  { ariaLabel: undefined, triggerLabel: undefined, expectedName: "Show options" },
  { ariaLabel: "", triggerLabel: undefined, expectedName: "Show options" },
  { ariaLabel: "Currency", triggerLabel: "Choose currency", expectedName: "Choose currency" },
])("names the rendered trigger $expectedName and preserves the input label", ({ ariaLabel, triggerLabel, expectedName }) => {
  const view = render(
    <Combobox items={["USD", "EUR"]}>
      <ComboboxInput aria-label={ariaLabel} triggerLabel={triggerLabel} />
    </Combobox>
  );

  const trigger = view.getByRole("button", { name: expectedName });
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.getAttribute("aria-label")).toBe(expectedName);
  expect(view.getByRole("combobox").getAttribute("aria-label")).toBe(ariaLabel ?? null);
});

test("does not render a default trigger when showTrigger is false", () => {
  const view = render(
    <Combobox items={["USD", "EUR"]}>
      <ComboboxInput aria-label="Currency" triggerLabel="Choose currency" showTrigger={false} />
    </Combobox>
  );

  expect(view.queryByRole("button")).toBeNull();
  expect(view.getByRole("combobox", { name: "Currency" })).toBeTruthy();
});
