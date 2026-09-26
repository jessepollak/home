import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { anonymousCountryPreferenceKey, legacyCountryPreferenceKey } from "@/config/country-preference";
import type { CountryCode, RegionId } from "@/config/regions";
import { isRegionAccountSignedIn, useHomeRegion } from "./use-home-region";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Region({ detectedCountry = null, accountPreference = null, accountIdentity = null, accountOwner = null, accountPreferencePending = false, signedIn = false, accountReady = false, accountSettling, accountStatus, writeAccountPreference }: {
  detectedCountry?: string | null;
  accountPreference?: CountryCode | null;
  signedIn?: boolean;
  accountIdentity?: string | null;
  accountOwner?: string | null;
  accountPreferencePending?: boolean;
  accountReady?: boolean;
  accountSettling?: boolean;
  accountStatus?: { status: "verified" | "signed-out" | "restoring" | "validating" | "unavailable"; isSignedIn: boolean };
  writeAccountPreference?: (regionId: CountryCode, adopt: boolean) => Promise<CountryCode>;
}) {
  const { regionId, resolutionSource, isPreferenceReady, preferenceMessage, selectRegion } = useHomeRegion({
    detectedCountry, accountPreference, accountIdentity, accountOwner, accountPreferencePending, signedIn: accountStatus ? isRegionAccountSignedIn(accountStatus) : signedIn,
    accountReady, accountSettling: accountSettling ?? (accountStatus?.status === "restoring" || accountStatus?.status === "validating"),
    writeAccountPreference,
  });
  return <>
    <output>{isPreferenceReady ? `${regionId}:${resolutionSource}` : `pending:${regionId}`}</output>
    <button onClick={() => selectRegion("GB")}>Choose GB</button>
    <button onClick={() => selectRegion("MX")}>Choose MX</button>
    <span>{preferenceMessage}</span>
  </>;
}

async function renderResolved(props: Parameters<typeof Region>[0]) {
  const view = render(<Region {...props} />);
  await waitFor(() => expect(view.getByRole("status").textContent?.startsWith("pending:")).toBe(false));
  return view;
}

describe("useHomeRegion", () => {
  test("holds browser hydration and adoption until an account read settles with no preference", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountIdentity="account-a" accountPreferencePending signedIn writeAccountPreference={writer} />);
    expect(view.getByRole("status").textContent).toBe("pending:BR");
    expect(calls).toEqual([]);
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("MX:persisted"));
    await waitFor(() => expect(calls).toEqual([["MX", true]]));
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" signedIn accountReady writeAccountPreference={writer} />);
    expect(calls).toEqual([["MX", true]]);
  });

  test("holds browser hydration until the account read settles with a saved preference", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const view = render(<Region detectedCountry="BR" accountIdentity="account-a" accountPreferencePending signedIn />);
    expect(view.getByRole("status").textContent).toBe("pending:BR");
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" accountPreference="DE" signedIn accountReady />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("DE:persisted"));
  });

  test("an explicit selection while the read is pending saves only after settlement", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountIdentity="account-a" accountPreferencePending signedIn writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("pending:GB");
    expect(calls).toEqual([]);
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" accountPreference="DE" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
  });
  for (const savedPreference of [null, "DE" as const]) {
    for (const writeOutcome of ["pending", "failed", "saved"] as const) {
      test(`a pre-identity restoring choice stays visible through the read (${savedPreference ?? "no saved preference"}, ${writeOutcome} write)`, async () => {
        window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
        const calls: Array<[CountryCode, boolean]> = [];
        const writer = async (id: CountryCode, adopt: boolean): Promise<CountryCode> => {
          calls.push([id, adopt]);
          if (writeOutcome === "pending") return new Promise<CountryCode>(() => {});
          if (writeOutcome === "failed") throw new Error("unavailable");
          return id;
        };
        const view = render(<Region detectedCountry="BR" accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
        fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
        expect(view.getByRole("status").textContent).toBe("GB:explicit");
        view.rerender(<Region detectedCountry="BR" accountOwner="owner-a" accountIdentity="account-a"
          accountPreferencePending accountStatus={{ status: "verified", isSignedIn: true }} writeAccountPreference={writer} />);
        expect(view.getByRole("status").textContent).toBe("pending:GB");
        expect(calls).toEqual([]);
        view.rerender(<Region detectedCountry="BR" accountOwner="owner-a" accountIdentity="account-a"
          accountPreference={savedPreference} accountReady accountStatus={{ status: "verified", isSignedIn: true }} writeAccountPreference={writer} />);
        await waitFor(() => expect(view.getByRole("status").textContent).toBe("GB:explicit"));
        await waitFor(() => expect(calls).toEqual([["GB", false]]));
        if (writeOutcome === "failed") {
          await waitFor(() => expect(view.getByText("Country updated for this visit only. Could not save to your account.")).toBeTruthy());
          expect(view.getByRole("status").textContent).toBe("GB:explicit");
        }
        expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
      });
    }
  }

  test("late browser hydration cannot replace a held choice after the account read", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = (id) => { frames.delete(id); };
    try {
      const calls: Array<[CountryCode, boolean]> = [];
      const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
      const view = render(<Region detectedCountry="BR" accountSettling accountPreferencePending writeAccountPreference={writer} />);
      fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
      view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" accountOwner="owner-a" accountPreferencePending signedIn writeAccountPreference={writer} />);
      expect(view.getByRole("status").textContent).toBe("pending:GB");
      view.rerender(<Region detectedCountry="BR" accountIdentity="account-a" accountOwner="owner-a" signedIn accountReady writeAccountPreference={writer} />);
      await waitFor(() => expect(calls).toEqual([["GB", false]]));
      expect(frames.size).toBeGreaterThan(0);
      act(() => { for (const callback of frames.values()) callback(performance.now()); frames.clear(); });
      expect(view.getByRole("status").textContent).toBe("GB:explicit");
    } finally {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
    }
  });

  test("real account-status wiring routes signed-out selection to browser without account request", async () => {
    const accountRequests: CountryCode[] = [];
    const view = await renderResolved({ accountStatus: { status: "signed-out", isSignedIn: false },
      writeAccountPreference: async (id) => { accountRequests.push(id); return id; } });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
    expect(accountRequests).toEqual([]);
  });

  test("real account-status wiring routes verified selection to the account without browser write", async () => {
    const accountRequests: Array<[CountryCode, boolean]> = [];
    const view = await renderResolved({ accountStatus: { status: "verified", isSignedIn: true }, accountReady: true, accountPreference: "DE",
      writeAccountPreference: async (id, adopt) => { accountRequests.push([id, adopt]); return id; } });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(accountRequests).toEqual([["GB", false]]));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("a choice during restoring overrides the server preference after verification", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const restoring = { status: "restoring" as const, isSignedIn: true };
    const verified = { status: "verified" as const, isSignedIn: true };
    const view = render(<Region accountPreference="DE" accountStatus={restoring} writeAccountPreference={writer} />);
    expect(view.getByRole("status").textContent).toBe("DE:persisted");
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(calls).toEqual([]);
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    view.rerender(<Region accountPreference="DE" accountStatus={verified} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    expect(calls).toEqual([["GB", false]]);
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("a settling choice wins over a browser preference without adopting it", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ accountStatus: { status: "validating", isSignedIn: true }, writeAccountPreference: writer });
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
    expect(calls).toEqual([]);
    view.rerender(<Region signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    expect(calls).toEqual([["GB", false]]);
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
  });

  test("a settling choice saves to the browser when the account settles signed out", async () => {
    const calls: CountryCode[] = [];
    const writer = async (id: CountryCode) => { calls.push(id); return id; };
    const view = await renderResolved({ accountSettling: true, writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    view.rerender(<Region accountSettling={false} writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved on this device.")).toBeTruthy());
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
    expect(calls).toEqual([]);
  });

  test("only the last of several settling choices is saved to the account", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region accountPreference="DE" accountSettling writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    fireEvent.click(view.getByRole("button", { name: "Choose MX" }));
    view.rerender(<Region accountPreference="DE" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    expect(calls).toEqual([["MX", false]]);
    expect(view.getByRole("status").textContent).toBe("MX:explicit");
  });

  test("a settling choice waits for server verification after the session settles signed in", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region accountPreference="DE" accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(calls).toEqual([]);
    view.rerender(<Region accountPreference="DE" accountStatus={{ status: "unavailable", isSignedIn: true }} writeAccountPreference={writer} />);
    expect(calls).toEqual([]);
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    view.rerender(<Region accountPreference="DE" accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
  });

  test("a signed-in unavailable choice waits for verification without a failure message", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ accountStatus: { status: "unavailable", isSignedIn: true }, writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(calls).toEqual([]);
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(view.container.querySelector("span")?.textContent).toBe("");
    view.rerender(<Region accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    expect(calls).toEqual([["GB", false]]);
  });

  test("a held unavailable choice is dropped when a different SDK owner verifies with a preference", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ detectedCountry: "BR", accountOwner: "owner-a",
      accountStatus: { status: "unavailable", isSignedIn: true }, writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-b" accountIdentity="account-b"
      accountPreference="DE" accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("DE:persisted"));
    expect(calls).toEqual([]);
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("a held restoring choice is dropped when a different SDK owner has no saved preference", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountOwner="owner-a"
      accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-b" accountIdentity="account-b"
      accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:detected"));
    expect(calls).toEqual([]);
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("a held restoring choice writes after the same SDK owner verifies", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountOwner="owner-a"
      accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-a" accountIdentity="account-a" accountPreference="DE"
      accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("GB:explicit"));
  });

  test("a held choice made before SDK initialization binds to the first owner", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountSettling writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-a"
      accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
    expect(calls).toEqual([]);
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-a" accountIdentity="account-a" accountPreference="DE"
      accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-a" accountIdentity="account-a" accountPreference="DE"
      accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    expect(calls).toEqual([["GB", false]]);
  });

  test("a held choice made before SDK initialization does not cross its first owner", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountSettling writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-a"
      accountStatus={{ status: "restoring", isSignedIn: true }} writeAccountPreference={writer} />);
    view.rerender(<Region detectedCountry="BR" accountOwner="owner-b" accountIdentity="account-b"
      accountStatus={{ status: "verified", isSignedIn: true }} accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:detected"));
    expect(calls).toEqual([]);
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("a signed-in unavailable choice saves to the browser on sign-out", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ accountOwner: "owner-a", accountStatus: { status: "unavailable", isSignedIn: true }, writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    expect(calls).toEqual([]);
    view.rerender(<Region accountStatus={{ status: "signed-out", isSignedIn: false }} writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country preference saved on this device.")).toBeTruthy());
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
    expect(calls).toEqual([]);
  });

  test("a failed settling account write leaves the choice for this visit", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean): Promise<CountryCode> => {
      calls.push([id, adopt]);
      throw new Error("unavailable");
    };
    const view = render(<Region accountPreference="DE" accountSettling writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region accountPreference="DE" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByText("Country updated for this visit only. Could not save to your account.")).toBeTruthy());
    expect(calls).toEqual([["GB", false]]);
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("signed-in saved preference wins over browser and detected without adoption", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: string[] = [];
    const view = render(<Region detectedCountry="BR" accountPreference="DE" signedIn accountReady writeAccountPreference={async (id) => { calls.push(id); return id; }} />);
    expect(view.getByRole("status").textContent).toBe("DE:persisted");
    await waitFor(() => expect(calls).toEqual([]));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
  });

  test("a legacy browser value displays while signed out but is never adopted on sign-in", async () => {
    window.localStorage.setItem(legacyCountryPreferenceKey, "MX");
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ detectedCountry: "BR", writeAccountPreference: writer });
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    view.rerender(<Region detectedCountry="BR" signedIn accountReady writeAccountPreference={writer} />);
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    expect(calls).toEqual([]);
  });

  test("an explicit browser choice made while signed out adopts after sign-in", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
    view.rerender(<Region signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", true]]));
    view.rerender(<Region signedIn accountReady writeAccountPreference={writer} />);
    expect(calls).toEqual([["GB", true]]);
  });

  test("a second account in the same shell adopts its own browser choice", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region signedIn accountReady accountIdentity="account-a" writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", true]]));
    view.rerender(<Region writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose MX" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
    view.rerender(<Region signedIn accountReady accountIdentity="account-b" writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", true], ["MX", true]]));
  });

  test("an account switch drops the previous account's pending write and shows the new account's preference", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    let finishWrite!: (regionId: CountryCode) => void;
    const pending = new Promise<CountryCode>((resolve) => { finishWrite = resolve; });
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return pending; };
    const view = await renderResolved({ signedIn: true, accountReady: true, accountIdentity: "account-a", accountPreference: "DE",
      writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    view.rerender(<Region signedIn accountReady accountIdentity="account-b" accountPreference="BR" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:persisted"));
    await act(async () => { finishWrite("GB"); await pending; });
    expect(view.getByRole("status").textContent).toBe("BR:persisted");
    expect(view.container.querySelector("span")?.textContent).toBe("");
  });

  test("a choice held for one account's pending read is never written to the next account", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountIdentity="account-a" accountPreferencePending signedIn writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-b" accountPreferencePending signedIn writeAccountPreference={writer} />);
    expect(view.getByRole("status").textContent).toBe("pending:BR");
    view.rerender(<Region detectedCountry="BR" accountIdentity="account-b" accountPreference="DE" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("DE:persisted"));
    expect(calls).toEqual([]);
  });

  test("a choice held for one account's pending read is dropped when that account signs out", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = render(<Region detectedCountry="BR" accountIdentity="account-a" accountPreferencePending signedIn writeAccountPreference={writer} />);
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:detected"));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("the same account signing back in after an explicit choice is ready with its saved preference", async () => {
    const writer = async (id: CountryCode) => id;
    const view = await renderResolved({ detectedCountry: "BR", signedIn: true, accountReady: true, accountIdentity: "account-a",
      accountPreference: "DE", writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    view.rerender(<Region detectedCountry="BR" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:detected"));
    view.rerender(<Region detectedCountry="BR" signedIn accountReady accountIdentity="account-a" accountPreference="GB" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("GB:persisted"));
  });

  test("an explicit signed-out choice yields to a saved account preference on sign-in", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ detectedCountry: "BR", writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    view.rerender(<Region detectedCountry="BR" signedIn accountReady accountIdentity="account-a" accountPreference="DE" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("DE:persisted"));
    expect(calls).toEqual([]);
  });

  test("a new account can save while the previous account's write remains pending", async () => {
    const calls: Array<[CountryCode, boolean]> = [];
    const pending = new Promise<CountryCode>(() => {});
    const writer = async (id: CountryCode, adopt: boolean) => {
      calls.push([id, adopt]);
      return id === "GB" ? pending : id;
    };
    const view = await renderResolved({ signedIn: true, accountReady: true, accountIdentity: "account-a", accountPreference: "DE",
      writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(calls).toEqual([["GB", false]]));

    view.rerender(<Region signedIn accountReady accountIdentity="account-b" accountPreference="BR" writeAccountPreference={writer} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("BR:persisted"));
    fireEvent.click(view.getByRole("button", { name: "Choose MX" }));
    await waitFor(() => expect(calls).toEqual([["GB", false], ["MX", false]]));
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
    expect(view.getByRole("status").textContent).toBe("MX:explicit");
  });

  test("GLOBAL in browser storage cannot be adopted", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "GLOBAL");
    const calls: CountryCode[] = [];
    const view = await renderResolved({ detectedCountry: "BR", signedIn: true, accountReady: true,
      writeAccountPreference: async (id) => { calls.push(id); return id; } });
    expect(view.getByRole("status").textContent).toBe("BR:detected");
    expect(calls).toEqual([]);
  });

  test("browser choice hydrates before account verification, then adopts exactly once", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: Array<[RegionId, boolean]> = [];
    let finishAdoption!: (regionId: CountryCode) => void;
    const adoption = new Promise<CountryCode>((resolve) => { finishAdoption = resolve; });
    const writer = async (id: CountryCode, adopt: boolean) => {
      calls.push([id, adopt]);
      return adoption;
    };
    const view = await renderResolved({ detectedCountry: "BR", signedIn: true, writeAccountPreference: writer });
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    expect(calls).toEqual([]);
    view.rerender(<Region detectedCountry="BR" signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["MX", true]]));
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    view.rerender(<Region detectedCountry="BR" signedIn accountReady writeAccountPreference={(id, adopt) => writer(id, adopt)} />);
    await act(async () => { finishAdoption("GB"); });
    expect(view.getByRole("status").textContent).toBe("GB:persisted");
    expect(calls).toEqual([["MX", true]]);
  });

  test("failed background adoption stays silent and is not retried on rerender", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: RegionId[] = [];
    const writer = async (id: CountryCode) => { calls.push(id); throw new Error("unavailable"); };
    const view = await renderResolved({ signedIn: true, accountReady: true, writeAccountPreference: writer });
    await waitFor(() => expect(calls).toEqual(["MX"]));
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    expect(view.container.querySelector("span")?.textContent).toBe("");
    view.rerender(<Region signedIn accountReady writeAccountPreference={writer} />);
    expect(calls).toEqual(["MX"]);
  });

  test("retries failed adoption on a new writer but does not repeat a successful adoption", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: Array<[CountryCode, boolean]> = [];
    let rejectFirst!: (reason: Error) => void;
    const firstAdoption = new Promise<CountryCode>((_resolve, reject) => { rejectFirst = reject; });
    const firstWriter = async (id: CountryCode, adopt: boolean) => {
      calls.push([id, adopt]);
      return firstAdoption;
    };
    const view = await renderResolved({ signedIn: true, accountReady: true, writeAccountPreference: firstWriter });
    await waitFor(() => expect(calls).toEqual([["MX", true]]));
    await act(async () => { rejectFirst(new Error("unavailable")); });
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    expect(view.container.querySelector("span")?.textContent).toBe("");

    const retryWriter = async (id: CountryCode, adopt: boolean) => {
      calls.push([id, adopt]);
      return id;
    };
    view.rerender(<Region signedIn accountReady writeAccountPreference={retryWriter} />);
    await waitFor(() => expect(calls).toEqual([["MX", true], ["MX", true]]));
    view.rerender(<Region signedIn accountReady writeAccountPreference={async (id, adopt) => {
      calls.push([id, adopt]);
      return id;
    }} />);
    expect(calls).toEqual([["MX", true], ["MX", true]]);
  });

  test("user selection before verification prevents adoption", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const calls: Array<[RegionId, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => { calls.push([id, adopt]); return id; };
    const view = await renderResolved({ signedIn: true, writeAccountPreference: writer });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(calls).toEqual([]);
    view.rerender(<Region signedIn accountReady writeAccountPreference={writer} />);
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
  });

  test("selection during adoption preserves the explicit account write and region", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    let finishAdoption!: (regionId: CountryCode) => void;
    const adoption = new Promise<CountryCode>((resolve) => { finishAdoption = resolve; });
    const calls: Array<[RegionId, boolean]> = [];
    const writer = async (id: CountryCode, adopt: boolean) => {
      calls.push([id, adopt]);
      return adopt ? adoption : id;
    };
    const view = await renderResolved({ signedIn: true, accountReady: true, writeAccountPreference: writer });
    await waitFor(() => expect(calls).toEqual([["MX", true]]));
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
    await act(async () => { finishAdoption("DE"); });
    await waitFor(() => expect(calls).toEqual([["MX", true], ["GB", false]]));
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
  });

  test("signed-out browser choice wins over detection and persists explicit selection", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");
    const view = await renderResolved({ detectedCountry: "BR" });
    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
  });

  test("detected and default countries do not write browser preference", async () => {
    expect((await renderResolved({ detectedCountry: "BR" })).getByRole("status").textContent).toBe("BR:detected");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    cleanup();
    expect((await renderResolved({})).getByRole("status").textContent).toBe("US:fallback");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
  });

  test("signed-in selection writes account and never browser", async () => {
    const calls: Array<[RegionId, boolean]> = [];
    const view = await renderResolved({ signedIn: true, accountReady: true, accountPreference: "DE", writeAccountPreference: async (id, adopt) => { calls.push([id, adopt]); return id; } });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(calls).toEqual([["GB", false]]));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBeNull();
    await waitFor(() => expect(view.getByText("Country preference saved to your account.")).toBeTruthy());
  });

  test("rapid signed-in choices persist in selection order", async () => {
    const calls: RegionId[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const view = await renderResolved({ signedIn: true, accountReady: true, accountPreference: "DE", writeAccountPreference: async (id) => {
      calls.push(id);
      if (id === "GB") await first;
      return id;
    } });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    fireEvent.click(view.getByRole("button", { name: "Choose MX" }));
    expect(calls).toEqual(["GB"]);
    release();
    await waitFor(() => expect(calls).toEqual(["GB", "MX"]));
    expect(view.getByRole("status").textContent).toBe("MX:explicit");
  });

  test("signed-in save failure keeps this visit's selection with an honest message", async () => {
    const view = await renderResolved({ signedIn: true, accountReady: true, accountPreference: "DE", writeAccountPreference: async () => { throw new Error("unavailable"); } });
    fireEvent.click(view.getByRole("button", { name: "Choose GB" }));
    await waitFor(() => expect(view.getByText("Country updated for this visit only. Could not save to your account.")).toBeTruthy());
    expect(view.getByRole("status").textContent).toBe("GB:explicit");
  });
});
