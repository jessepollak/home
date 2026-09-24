import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { anonymousCountryPreferenceKey } from "@/config/country-preference";
import { useHomeRegion } from "./use-home-region";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Region({ detectedCountry }: { detectedCountry: string | null }) {
  const { regionId, resolutionSource, isPreferenceReady, selectRegion } = useHomeRegion({
    detectedCountry,
  });
  return (
    <>
      <output>{isPreferenceReady ? `${regionId}:${resolutionSource}` : "pending"}</output>
      <button onClick={() => selectRegion("GB")}>Choose GB</button>
    </>
  );
}

async function renderResolved(detectedCountry: string | null) {
  const view = render(<Region detectedCountry={detectedCountry} />);
  await waitFor(() => expect(view.getByRole("status").textContent).not.toBe("pending"));
  return view;
}

describe("useHomeRegion", () => {
  test("sets a new user's country from geolocation and stores it", async () => {
    const view = await renderResolved("BR");

    expect(view.getByRole("status").textContent).toBe("BR:detected");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("BR");
  });

  test("stores US when geolocation is missing or unsupported", async () => {
    const view = await renderResolved(null);

    expect(view.getByRole("status").textContent).toBe("US:fallback");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("US");
  });

  test("backfills a stored GLOBAL country with the geolocated country", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "GLOBAL");

    const view = await renderResolved("DE");

    expect(view.getByRole("status").textContent).toBe("DE:detected");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("DE");
  });

  test("never overwrites a stored country with geolocation", async () => {
    window.localStorage.setItem(anonymousCountryPreferenceKey, "MX");

    const view = await renderResolved("BR");

    expect(view.getByRole("status").textContent).toBe("MX:persisted");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("MX");
  });

  test("keeps an explicit choice over the next geolocated visit", async () => {
    const first = await renderResolved("BR");
    fireEvent.click(first.getByRole("button", { name: "Choose GB" }));
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
    cleanup();

    const next = await renderResolved("US");

    expect(next.getByRole("status").textContent).toBe("GB:persisted");
    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
  });
});
