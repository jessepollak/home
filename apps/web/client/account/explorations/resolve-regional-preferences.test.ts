import { describe, expect, test } from "bun:test";
import { defaultRegionalPreferences, resolveRegionalPreferences } from "./resolve-regional-preferences";

describe("regional preferences proposal", () => {
  test("country change keeps explicit currency and updates default language", () => {
    const chosen = resolveRegionalPreferences(defaultRegionalPreferences("BR"), { field: "currency", value: "USD" });
    expect(resolveRegionalPreferences(chosen, { field: "country", value: "NG" })).toEqual({
      country: "NG",
      currency: { mode: "explicit", value: "USD" },
      language: { mode: "country-default", value: "English" },
    });
  });

  test("both defaults follow a changed country", () => {
    expect(resolveRegionalPreferences(defaultRegionalPreferences("US"), { field: "country", value: "ID" })).toEqual({
      country: "ID",
      currency: { mode: "country-default", value: "IDR" },
      language: { mode: "country-default", value: "Bahasa Indonesia" },
    });
  });

  test("returning to the country default follows the next change", () => {
    const chosen = resolveRegionalPreferences(defaultRegionalPreferences("BR"), { field: "currency", value: "USD" });
    const reset = resolveRegionalPreferences(chosen, { field: "currency", value: "country-default" });
    expect(resolveRegionalPreferences(reset, { field: "country", value: "NG" }).currency).toEqual({
      mode: "country-default", value: "NGN",
    });
  });

  test("language choice does not change country or currency", () => {
    expect(resolveRegionalPreferences(defaultRegionalPreferences("US"), { field: "language", value: "Português" })).toEqual({
      country: "US",
      currency: { mode: "country-default", value: "USD" },
      language: { mode: "explicit", value: "Português" },
    });
  });
});
