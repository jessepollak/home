import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  countryDefaultValue,
  RegionalPreferencesProposal,
  type RegionalPreferencesCopy,
} from "./regional-preferences-proposal";

afterEach(cleanup);

const copy: RegionalPreferencesCopy = {
  country: "Country",
  countryDescription: "Controls eligibility.",
  displayCurrency: "Display currency",
  displayCurrencyDescription: "Presentation only.",
  language: "Language",
  languageDescription: "Copy and formatting only.",
  noCountriesFound: "No countries found.",
  preferenceIndependenceDescription: "Each preference stays independent.",
  preferences: "Regional preferences",
  searchCountries: "Search countries",
  useCountryDefault: "Use country default",
};

const options = [{ value: "one", label: "One" }, { value: "two", label: "Two" }];

describe("RegionalPreferencesProposal", () => {
  test("offers a per-field country-default choice without changing country", async () => {
    const onCountryChange = mock(() => {});
    const onDisplayCurrencyChange = mock(() => {});
    const onLanguageChange = mock(() => {});
    const view = render(
      <RegionalPreferencesProposal
        copy={copy}
        countryDefaultCurrency="BRL"
        countryDefaultLanguage="Português (Brasil)"
        countryOptions={options}
        currencyOptions={options}
        languageOptions={options}
        value={{ country: "one", displayCurrency: "two", language: "two" }}
        onCountryChange={onCountryChange}
        onDisplayCurrencyChange={onDisplayCurrencyChange}
        onLanguageChange={onLanguageChange}
      />,
    );

    fireEvent.click(view.getByRole("combobox", { name: "Display currency" }));
    const countryDefaultOption = await view.findByRole("option", { name: "Use country default" });
    fireEvent.pointerDown(countryDefaultOption);
    fireEvent.click(countryDefaultOption);

    expect(onDisplayCurrencyChange).toHaveBeenCalledWith(countryDefaultValue);
    expect(onLanguageChange).not.toHaveBeenCalled();
    expect(onCountryChange).not.toHaveBeenCalled();
  });

  test("announces the resolved default while each field follows country", () => {
    const view = render(
      <RegionalPreferencesProposal
        copy={copy}
        countryDefaultCurrency="IDR"
        countryDefaultLanguage="Bahasa Indonesia"
        countryOptions={options}
        currencyOptions={options}
        languageOptions={options}
        value={{
          country: "one",
          displayCurrency: countryDefaultValue,
          language: countryDefaultValue,
        }}
        onCountryChange={() => {}}
        onDisplayCurrencyChange={() => {}}
        onLanguageChange={() => {}}
      />,
    );

    expect(view.getByText("IDR")).toBeTruthy();
    expect(view.getByText("Bahasa Indonesia")).toBeTruthy();
  });
});
