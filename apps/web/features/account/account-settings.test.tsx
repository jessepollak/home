import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import {
  anonymousCountryPreferenceKey,
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  presentationRegions,
  resolvePresentation,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";

const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { AccountSettings } = await import("./account-settings");

function memoryPreferenceStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function AccountRegionPresentationContract({
  storage,
  detectedCountry,
}: {
  storage: ReturnType<typeof memoryPreferenceStorage>;
  detectedCountry: string;
}) {
  const initial = resolvePresentation({
    persistedCountry: readAnonymousCountryPreference(() => storage),
    detectedCountry,
  });
  const [regionId, setRegionId] = useState<RegionId>(initial.region.id);
  const [resolutionSource, setResolutionSource] =
    useState<ResolutionSource>(initial.source);
  const region = presentationRegions[regionId];

  function selectRegion(nextRegionId: RegionId) {
    writeAnonymousCountryPreference(() => storage, nextRegionId);
    setRegionId(nextRegionId);
    setResolutionSource("explicit");
  }

  return (
    <>
      <AccountSettings
        regionId={regionId}
        onRegionChange={selectRegion}
        resolutionSource={resolutionSource}
        preferenceMessage=""
        isPreferenceReady
        accountAddress="0x1111111111111111111111111111111111111111"
        onSignOut={() => {}}
      />
      <output aria-label="Home currency name">{region.currency.name}</output>
      <output aria-label="Home currency code">
        {region.currency.code ?? "none"}
      </output>
    </>
  );
}

afterEach(() => cleanup());

describe("account settings", () => {
  test("persists the Account country and restores the same Home currency presentation", () => {
    const storage = memoryPreferenceStorage();
    const firstVisit = render(
      <AccountRegionPresentationContract
        storage={storage}
        detectedCountry="US"
      />,
    );

    expect(firstVisit.getByLabelText("Home currency name").textContent).toBe(
      "US dollar",
    );
    expect(firstVisit.getByLabelText("Home currency code").textContent).toBe(
      "USD",
    );

    fireEvent.click(firstVisit.getByRole("combobox", { name: "Country" }));
    fireEvent.click(
      within(document.body).getByRole("option", { name: /Brazil/ }),
    );

    expect(storage.getItem(anonymousCountryPreferenceKey)).toBe("BR");
    expect(firstVisit.getByLabelText("Home currency name").textContent).toBe(
      "Brazilian real",
    );
    expect(firstVisit.getByLabelText("Home currency code").textContent).toBe(
      "BRL",
    );

    firstVisit.unmount();
    const refreshed = render(
      <AccountRegionPresentationContract
        storage={storage}
        detectedCountry="US"
      />,
    );

    expect(
      refreshed.getByRole("combobox", { name: "Country" }).textContent,
    ).toContain("Brazil");
    expect(refreshed.getByLabelText("Home currency name").textContent).toBe(
      "Brazilian real",
    );
    expect(refreshed.getByLabelText("Home currency code").textContent).toBe(
      "BRL",
    );
    expect(refreshed.getByText("Saved country choice.")).toBeTruthy();
  });

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
