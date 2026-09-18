import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { NativeSelect } = await import("./native-select");

afterEach(cleanup);

describe("NativeSelect", () => {
  test("renders the native control at a mobile-safe font size at every viewport width", () => {
    const view = render(<NativeSelect aria-label="Sort" defaultValue="gdp">
      <option value="gdp">GDP</option>
    </NativeSelect>);
    const select = view.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement;
    expect(select.className).toContain("text-base");
    expect(select.className).not.toContain("md:text-sm");
  });
});
