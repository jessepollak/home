import "@/client/account/dom-test-harness";

import { useState } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { AppearancePreference } from "@/shared/appearance/preference";
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
          appearancePreference="system"
          onAppearancePreferenceChange={() => true}
          onSignOut={() => {}}
        />
      );
    }

    const view = render(<SettingsWithPreference />);
    const preferenceSwitch = view.getByRole("switch", { name: "Show small balances" });
    await waitFor(() => expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(preferenceSwitch);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");
    await waitFor(() =>
      expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBe("false"),
    );

    fireEvent.keyDown(preferenceSwitch, { key: " ", code: "Space" });
    fireEvent.keyUp(preferenceSwitch, { key: " ", code: "Space" });
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");
    await waitFor(() =>
      expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBe("true"),
    );
  });

  test("shows the current appearance and selects a new preference", () => {
    const onAppearancePreferenceChange = mock((_value: AppearancePreference) => true);
    function Settings() {
      const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>("dark");
      return (
        <AccountSettings
          regionId="US"
          onRegionChange={() => {}}
          resolutionSource="persisted"
          preferenceMessage=""
          isPreferenceReady
          accountAddress={null}
          showSmallBalances={false}
          onShowSmallBalancesChange={() => {}}
          appearancePreference={appearancePreference}
          onAppearancePreferenceChange={(next) => {
            onAppearancePreferenceChange(next);
            setAppearancePreference(next);
            return true;
          }}
          onSignOut={() => {}}
        />
      );
    }
    const view = render(<Settings />);
    const group = view.getByRole("radiogroup", { name: "Appearance" });
    const light = view.getByRole("radio", { name: "Light" });
    const dark = view.getByRole("radio", { name: "Dark" });
    const system = view.getByRole("radio", { name: "System" });
    expect(group).toBeTruthy();
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(light.getAttribute("aria-checked")).toBe("false");
    expect(system.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(system);
    expect(onAppearancePreferenceChange).toHaveBeenCalledWith("system");
    expect(system.getAttribute("aria-checked")).toBe("true");
  });

  test("keeps appearance and country persistence results in separate live regions", () => {
    function Settings({ preferenceMessage }: { preferenceMessage: string }) {
      const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>("light");
      return (
        <AccountSettings
          regionId="US"
          onRegionChange={() => {}}
          resolutionSource="persisted"
          preferenceMessage={preferenceMessage}
          isPreferenceReady
          accountAddress={null}
          showSmallBalances={false}
          onShowSmallBalancesChange={() => {}}
          appearancePreference={appearancePreference}
          onAppearancePreferenceChange={(next) => {
            setAppearancePreference(next);
            return false;
          }}
          onSignOut={() => {}}
        />
      );
    }
    const view = render(<Settings preferenceMessage="" />);
    const group = view.getByRole("radiogroup", { name: "Appearance" });
    fireEvent.click(view.getByRole("radio", { name: "Dark" }));
    expect(view.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    const appearanceMessage = "Appearance updated for this visit. Browser storage is unavailable.";
    const appearanceStatus = view.getAllByRole("status").find((region) => region.textContent === appearanceMessage);
    expect(appearanceStatus?.getAttribute("aria-live")).toBe("polite");
    expect(group.getAttribute("aria-describedby")).toBe(appearanceStatus?.id ?? null);

    view.rerender(<Settings preferenceMessage="Country saved on this device." />);
    const statuses = view.getAllByRole("status").map((region) => region.textContent);
    expect(statuses).toContain("Country saved on this device.");
    expect(statuses).toContain(appearanceMessage);
  });
});
