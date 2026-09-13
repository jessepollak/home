import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { CountrySelect } = await import("./country-select");

afterEach(cleanup);

describe("CountrySelect", () => {
  test("searches full country labels and selects an option", async () => {
    const onValueChange = mock(() => {});
    const view = render(
      <CountrySelect
        value="GLOBAL"
        onValueChange={onValueChange}
        describedBy="country-help"
      />,
    );

    const input = view.getByRole("combobox", { name: "Country" });
    const trigger = input.parentElement?.querySelector("button");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    fireEvent.change(input, { target: { value: "United Kingdom" } });

    const option = await view.findByRole("option", { name: "United Kingdom" });
    fireEvent.click(option);

    expect(onValueChange).toHaveBeenCalledWith("GB");
  });
});
