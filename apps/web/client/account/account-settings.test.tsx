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

    const preferencesHeading = view.getByRole("heading", {
      level: 2,
      name: "Preferences",
    });
    const accountHeading = view.getByRole("heading", {
      level: 2,
      name: "Account",
    });
    expect(preferencesHeading.getAttribute("data-text-style")).toBe(
      "section-title",
    );
    expect(accountHeading.getAttribute("data-text-style")).toBe(
      "section-title",
    );
    expect(
      view.getByText("Sets how money is shown").getAttribute("data-text-style"),
    ).toBe("metadata");
    expect(view.getByRole("combobox", { name: "Country" }).textContent).toContain(
      "Brazil",
    );
    expect(view.getByTitle("0x1111111111111111111111111111111111111111").textContent).toBe(
      "0x1111…111111",
    );

    const signOut = view.getByRole("button", { name: "Sign out" });
    expect(signOut.classList.contains("home-ui-button")).toBe(true);
    expect(signOut.getAttribute("data-variant")).toBe("quiet");
    expect(signOut.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(signOut.querySelector("svg")?.getAttribute("width")).toBe("20");
    fireEvent.click(view.getByRole("combobox", { name: "Country" }));
    fireEvent.click(within(document.body).getByRole("option", { name: /United States/ }));
    expect(changes).toEqual(["US"]);
  });
});
