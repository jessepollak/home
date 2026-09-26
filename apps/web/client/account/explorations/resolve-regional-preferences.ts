export type ProposalCountry = "US" | "BR" | "NG" | "ID";
export type ProposalCurrency = "USD" | "BRL" | "NGN" | "IDR";
export type ProposalLanguage = "English" | "Português" | "Bahasa Indonesia";
export type Preference<T> = { mode: "country-default" | "explicit"; value: T };
export type RegionalPreferences = {
  country: ProposalCountry;
  currency: Preference<ProposalCurrency>;
  language: Preference<ProposalLanguage>;
};

export const regionalDefaults: Record<ProposalCountry, { currency: ProposalCurrency; language: ProposalLanguage }> = {
  US: { currency: "USD", language: "English" },
  BR: { currency: "BRL", language: "Português" },
  NG: { currency: "NGN", language: "English" },
  ID: { currency: "IDR", language: "Bahasa Indonesia" },
};

export function resolveRegionalPreferences(
  current: RegionalPreferences,
  change:
    | { field: "country"; value: ProposalCountry }
    | { field: "currency"; value: ProposalCurrency | "country-default" }
    | { field: "language"; value: ProposalLanguage | "country-default" },
): RegionalPreferences {
  if (change.field === "country") {
    const defaults = regionalDefaults[change.value];
    return {
      country: change.value,
      currency: current.currency.mode === "explicit" ? current.currency : { mode: "country-default", value: defaults.currency },
      language: current.language.mode === "explicit" ? current.language : { mode: "country-default", value: defaults.language },
    };
  }
  if (change.field === "currency") {
    return {
      ...current,
      currency: change.value === "country-default"
        ? { mode: "country-default", value: regionalDefaults[current.country].currency }
        : { mode: "explicit", value: change.value },
    };
  }
  return {
    ...current,
    language: change.value === "country-default"
      ? { mode: "country-default", value: regionalDefaults[current.country].language }
      : { mode: "explicit", value: change.value },
  };
}

export function defaultRegionalPreferences(country: ProposalCountry): RegionalPreferences {
  const defaults = regionalDefaults[country];
  return {
    country,
    currency: { mode: "country-default", value: defaults.currency },
    language: { mode: "country-default", value: defaults.language },
  };
}
