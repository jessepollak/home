import "@/client/account/dom-test-harness";

import { useState } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
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

function inviteSettings(fetchAccountResource: AccountWalletClient["fetchAccountResource"], accountOwnerKey: string | null = "owner-a") {
  return (
    <AccountSettings
      regionId="US"
      onRegionChange={() => {}}
      resolutionSource="persisted"
      preferenceMessage=""
      isPreferenceReady
      accountAddress={accountOwnerKey ? "0x1111111111111111111111111111111111111111" : null}
      accountOwnerKey={accountOwnerKey}
      fetchAccountResource={fetchAccountResource}
      showSmallBalances={false}
      onShowSmallBalancesChange={() => {}}
      appearancePreference="system"
      onAppearancePreferenceChange={() => true}
      onSignOut={() => {}}
    />
  );
}

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
          fetchAccountResource={async () => ({ version: 1, code: "abcdefghjk" })}
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
          fetchAccountResource={async () => ({ version: 1, code: "abcdefghjk" })}
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

  test("copies the full invite URL from its LTR, scheme-free control", async () => {
    const url = `${window.location.origin}/invite/abcdefghjk`;
    const writeText = mock(async (_text: string) => {});
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const view = render(inviteSettings(async () => ({ version: 1, code: "abcdefghjk" })));
      const section = await view.findByRole("region", { name: "Invite friends" });
      const copy = await within(section).findByRole("button", { name: /^Copy invite link / });
      expect(copy.getAttribute("title")).toBe(url);
      expect(copy.textContent).toContain(url.replace(/^https?:\/\//, ""));
      expect(copy.closest('[dir="ltr"]')).toBeTruthy();
      fireEvent.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
      await waitFor(() => expect(copy.textContent).toContain("Copied"));
      expect(within(section).getByRole("button", { name: "Copied" })).toBe(copy);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("offers the full invite URL for selection when clipboard access is unavailable or denied", async () => {
    const url = `${window.location.origin}/invite/abcdefghjk`;
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      const view = render(inviteSettings(async () => ({ version: 1, code: "abcdefghjk" }), "clipboard-owner"));
      const section = await view.findByRole("region", { name: "Invite friends" });
      const copy = await within(section).findByRole("button", { name: /^Copy invite link / });
      fireEvent.click(copy);
      expect(within(section).getByRole("alert").textContent).toBe(
        "Clipboard access is unavailable. Select and copy the full invite link below.",
      );
      expect(within(section).getByRole("code", { name: `Full invite link ${url}` }).textContent).toBe(url);
      const deniedWriteText = mock(async () => { throw new Error("denied"); });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: deniedWriteText },
      });
      fireEvent.click(copy);
      await waitFor(() => expect(deniedWriteText).toHaveBeenCalledWith(url));
      await waitFor(() => expect(within(section).getByRole("alert").textContent).toBe(
        "Clipboard access failed. Select and copy the full invite link below.",
      ));
      expect(within(section).getByRole("code", { name: `Full invite link ${url}` }).textContent).toBe(url);
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("only offers Share when supported and shares the URL", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "share");
    const share = mock(async (_data: ShareData) => {});
    try {
      Reflect.deleteProperty(navigator, "share");
      const fetchLink = async () => ({ version: 1, code: "abcdefghjk" });
      const view = render(inviteSettings(fetchLink));
      await view.findByTitle(`${window.location.origin}/invite/abcdefghjk`);
      expect(view.queryByRole("button", { name: "Share invite link" })).toBeNull();
      Object.defineProperty(navigator, "share", { configurable: true, value: share });
      view.rerender(inviteSettings(fetchLink));
      const shareButton = view.getByRole("button", { name: "Share invite link" });
      expect(shareButton.textContent).toBe("Share");
      fireEvent.click(shareButton);
      await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Home", url: `${window.location.origin}/invite/abcdefghjk` }));
    } finally {
      if (original) Object.defineProperty(navigator, "share", original);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  test("hydrates a share-capable invite link without a Share mismatch", async () => {
    const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];
    const hydrationErrors: unknown[] = [];
    let root: Root | null = null;
    let container: HTMLDivElement | null = null;
    Object.defineProperty(navigator, "share", { configurable: true, value: mock(async () => {}) });
    console.error = (...args: unknown[]) => { consoleErrors.push(args); };
    try {
      const ownerKey = "hydration-owner";
      const url = `${window.location.origin}/invite/abcdefghjk`;
      getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "invite-link"), url);
      const settings = inviteSettings(async () => ({ version: 1, code: "abcdefghjk" }), ownerKey);
      const serverMarkup = renderToString(settings);
      expect(serverMarkup).toContain("Invite friends");
      expect(serverMarkup).toContain("abcdefghjk");
      expect(serverMarkup).not.toContain('aria-label="Share invite link"');

      container = document.createElement("div");
      container.innerHTML = serverMarkup;
      document.body.append(container);
      await act(async () => {
        root = hydrateRoot(container!, settings, {
          onRecoverableError: (error) => hydrationErrors.push(error),
        });
      });
      expect(hydrationErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(within(container).getByRole("button", { name: "Share invite link" })).toBeTruthy();
    } finally {
      if (root) await act(async () => root?.unmount());
      container?.remove();
      console.error = originalConsoleError;
      if (originalShare) Object.defineProperty(navigator, "share", originalShare);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  test("shows one polite share failure and no error for a cancelled share", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "share");
    const share = mock(async () => { throw new Error("share failed"); });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    try {
      const view = render(inviteSettings(async () => ({ version: 1, code: "abcdefghjk" }), "share-error-owner"));
      const section = await view.findByRole("region", { name: "Invite friends" });
      const shareButton = await within(section).findByRole("button", { name: "Share invite link" });
      fireEvent.click(shareButton);
      const message = "Couldn't share your invite link.";
      await waitFor(() => expect(within(section).getByRole("status").textContent).toBe(message));
      expect(within(section).getAllByText(message)).toHaveLength(1);
      share.mockImplementationOnce(async () => { throw new DOMException("cancelled", "AbortError"); });
      fireEvent.click(shareButton);
      await waitFor(() => expect(within(section).queryByRole("status")).toBeNull());
    } finally {
      if (original) Object.defineProperty(navigator, "share", original);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  test("shows a labelled skeleton while loading", () => {
    const view = render(inviteSettings(async () => new Promise<unknown>(() => {}), "loading-owner"));
    expect(view.getByRole("region", { name: "Invite friends" })).toBeTruthy();
    expect(view.getByLabelText("Loading invite link")).toBeTruthy();
  });

  test("hides the section for an unavailable or missing account", async () => {
    const view = render(inviteSettings(async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }, "owner-b"));
    expect(view.getByLabelText("Loading invite link")).toBeTruthy();
    await waitFor(() => expect(view.queryByLabelText("Loading invite link") === null).toBe(true));
    expect(view.queryByRole("region", { name: "Invite friends" })).toBeNull();
    view.rerender(inviteSettings(async () => ({ version: 1, code: "abcdefghjk" }), null));
    expect(view.queryByRole("region", { name: "Invite friends" })).toBeNull();
  });

  test("shows an error with a retry that loads the link", async () => {
    let calls = 0;
    const view = render(inviteSettings(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return { version: 1, code: "abcdefghjk" };
    }, "owner-c"));
    await view.findByText("Couldn't load your invite link.");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByTitle(`${window.location.origin}/invite/abcdefghjk`);
    expect(calls).toBe(2);
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
          fetchAccountResource={async () => ({ version: 1, code: "abcdefghjk" })}
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
