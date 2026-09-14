import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  showSmallBalancesPreferenceKey,
  useShowSmallBalances,
} from "@/client/home/use-show-small-balances";
import { AccountSettings } from "./account-settings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AccountSettings", () => {
  test("binds the small-balances switch to the device preference", async () => {
    window.localStorage.setItem(showSmallBalancesPreferenceKey, "true");

    function SettingsWithPreference() {
      const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
      return (
        <AccountSettings
          regionId="US"
          onRegionChange={() => {}}
          resolutionSource="persisted"
          preferenceMessage=""
          isPreferenceReady
          accountAddress="0x1111111111111111111111111111111111111111"
          showSmallBalances={showSmallBalances}
          onShowSmallBalancesChange={setShowSmallBalances}
          onSignOut={() => {}}
        />
      );
    }

    const view = render(<SettingsWithPreference />);
    const preferenceSwitch = view.getByRole("switch", { name: "Show small balances" });
    await waitFor(() => expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(preferenceSwitch);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBe("false");
  });
});
