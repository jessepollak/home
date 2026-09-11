import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { AccountSettings } = await import("./account-settings");

afterEach(() => cleanup());

describe("account settings", () => {
  test("places country preference with presentation helper copy", () => {
    const changes: string[] = [];
    const view = render(
      <AccountSettings
        regionId="BR"
        onRegionChange={(region) => changes.push(region)}
        resolutionSource="detected"
        preferenceMessage=""
        isPreferenceReady
        accountAddress="0x1111111111111111111111111111111111111111"
        onSignOut={() => {}}
      />,
    );

    expect(view.getByText("Sets how money is shown")).toBeTruthy();
    expect(view.getByRole("combobox", { name: "Country" }).textContent).toContain(
      "Brazil",
    );
    expect(view.getByTitle("0x1111111111111111111111111111111111111111").textContent).toBe(
      "0x1111…111111",
    );
    fireEvent.click(view.getByRole("combobox", { name: "Country" }));
    fireEvent.click(within(document.body).getByRole("option", { name: /United States/ }));
    expect(changes).toEqual(["US"]);
  });
});
