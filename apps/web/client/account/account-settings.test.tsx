import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { HomeBalancesList } from "@/client/home/balances-panel";
import {
  showSmallBalancesPreferenceKey,
  useShowSmallBalances,
} from "@/client/home/use-show-small-balances";
import {
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { AccountSettings } from "./account-settings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AccountSettings", () => {
  test("binds the small-balances switch to the device preference", async () => {
    window.localStorage.setItem(showSmallBalancesPreferenceKey, "true");

    const snapshot = buildBalancesSnapshotFixture({
      catalog: [
        catalogHolding(
          {
            address: "0x7777777777777777777777777777777777777777",
            name: "Dust Token",
            symbol: "DUST",
            decimals: 18,
          },
          "1",
          priced("USD", "9", 3),
        ),
      ],
    });

    function SettingsWithPreference() {
      const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
      const presentation = presentBalances(
        { status: "ready", snapshot, error: null },
        { showSmallBalances },
      );
      return (
        <>
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
          <HomeBalancesList rows={presentation.rows} isLoading={false} />
        </>
      );
    }

    const view = render(<SettingsWithPreference />);
    const preferenceSwitch = view.getByRole("switch", { name: "Show small balances" });
    await waitFor(() => expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true"));
    expect(view.getByText("Dust Token")).toBeTruthy();

    fireEvent.click(preferenceSwitch);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");
    expect(view.queryByText("Dust Token")).toBeNull();
    await waitFor(() =>
      expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBe("false"),
    );

    fireEvent.keyDown(preferenceSwitch, { key: " ", code: "Space" });
    fireEvent.keyUp(preferenceSwitch, { key: " ", code: "Space" });
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");
    expect(view.getByText("Dust Token")).toBeTruthy();
    await waitFor(() =>
      expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBe("true"),
    );
  });
});
