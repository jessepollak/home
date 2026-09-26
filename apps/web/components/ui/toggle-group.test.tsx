import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ToggleGroup, ToggleGroupItem } = await import("./toggle-group");

afterEach(cleanup);

test("selecting a range updates the pressed item", () => {
  const view = render(
    <ToggleGroup defaultValue={["1D"]} aria-label="Price range" variant="outline" spacing={0}>
      <ToggleGroupItem value="1D">1D</ToggleGroupItem>
      <ToggleGroupItem value="1W">1W</ToggleGroupItem>
    </ToggleGroup>,
  );
  const day = view.getByRole("button", { name: "1D" });
  const week = view.getByRole("button", { name: "1W" });

  expect(day.getAttribute("aria-pressed")).toBe("true");
  expect(week.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(week);
  expect(day.getAttribute("aria-pressed")).toBe("false");
  expect(week.getAttribute("aria-pressed")).toBe("true");
  expect(week.hasAttribute("data-pressed")).toBe(true);
});

test("disabled options and a disabled group cannot change selection", () => {
  const view = render(
    <div>
      <ToggleGroup defaultValue={["1D"]} aria-label="Partial range" variant="outline">
        <ToggleGroupItem value="1D">1D</ToggleGroupItem>
        <ToggleGroupItem value="1W" disabled>1W</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup defaultValue={["1D"]} aria-label="Disabled range" variant="outline" disabled>
        <ToggleGroupItem value="1D">1D</ToggleGroupItem>
        <ToggleGroupItem value="1W">1W</ToggleGroupItem>
      </ToggleGroup>
    </div>,
  );
  const partial = view.getByRole("group", { name: "Partial range" });
  const disabled = view.getByRole("group", { name: "Disabled range" });
  const partialWeek = within(partial).getByRole<HTMLButtonElement>("button", { name: "1W" });
  const disabledWeek = within(disabled).getByRole<HTMLButtonElement>("button", { name: "1W" });

  expect(partialWeek.disabled).toBe(true);
  expect(disabledWeek.disabled).toBe(true);
  fireEvent.click(partialWeek);
  fireEvent.click(disabledWeek);
  expect(partialWeek.getAttribute("aria-pressed")).toBe("false");
  expect(disabledWeek.getAttribute("aria-pressed")).toBe("false");
});
