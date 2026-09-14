import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CountrySelect } = await import("./country-select");

afterEach(cleanup);

describe("CountrySelect", () => {
  test("presents countries as a select and excludes the legacy Global option", async () => {
    const onValueChange = mock(() => {});
    const view = render(
      <CountrySelect
        value="US"
        onValueChange={onValueChange}
        describedBy="country-help"
      />,
    );

    const select = view.getByRole("combobox", { name: "Country" });
    expect((select as HTMLInputElement).value).toBe("United States");
    const trigger = select.parentElement?.querySelector("button");
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger!);
    await waitFor(() => expect(select.getAttribute("aria-expanded")).toBe("true"));
    expect(view.queryByRole("option", { name: /Global/ })).toBeNull();

    fireEvent.click(await view.findByRole("option", { name: "United Kingdom" }));

    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("GB"));
  });
});
