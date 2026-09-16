export const countryRegionIds = [
  "AR",
  "AU",
  "AT",
  "BE",
  "BR",
  "BG",
  "CA",
  "CL",
  "CO",
  "HR",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "ID",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MY",
  "MT",
  "MX",
  "NL",
  "NZ",
  "NG",
  "PE",
  "PT",
  "SG",
  "SK",
  "SI",
  "ZA",
  "ES",
  "CH",
  "TR",
  "GB",
  "US",
] as const;

export const regionIds = ["GLOBAL", ...countryRegionIds] as const;

export type CountryCode = (typeof countryRegionIds)[number];
export type RegionId = (typeof regionIds)[number];

export type FiatCurrencyCode =
  | "ARS"
  | "AUD"
  | "BRL"
  | "CAD"
  | "CHF"
  | "CLP"
  | "COP"
  | "EUR"
  | "GBP"
  | "IDR"
  | "MXN"
  | "MYR"
  | "NGN"
  | "NZD"
  | "PEN"
  | "SGD"
  | "TRY"
  | "USD"
  | "ZAR";

export type CandidateVerificationStatus =
  | "Verification pending"
  | "Additional verification";

export type PresentationCandidateAsset = {
  symbol: string;
  issuer: string;
  selectionStatus: "confirmed-product-default";
  verificationStatus: CandidateVerificationStatus;
  fundingStatus: "disabled";
  source: typeof CURRENCY_DEFAULTS_SOURCE;
  note: string;
  contractSelection?: string;
};

export type PresentationRegion = {
  id: RegionId;
  countryCode: CountryCode | null;
  countryName: string;
  selectorLabel: string;
  currency: {
    code: FiatCurrencyCode | null;
    name: string;
    symbol: string | null;
  };
  candidateAsset: PresentationCandidateAsset | null;
  sources: {
    countryCurrencyMapping: string | null;
    defaultAsset: typeof CURRENCY_DEFAULTS_SOURCE | null;
  };
  theme: {
    accent: string;
    accentSoft: string;
    surface: string;
  };
  welcome: {
    eyebrow: string;
    title: string;
    body: string;
  };
};

export const REGIONAL_MONEY_SOURCE = "docs/regional-money.md";
export const CURRENCY_DEFAULTS_SOURCE = "docs/currency-defaults.md";
export const EURO_AREA_COUNTRIES_SOURCE =
  "https://european-union.europa.eu/institutions-law-budget/euro/countries-using-euro_en";

const baseTheme = {
  accent: "#0000FF",
  accentSoft: "#EEF0F3",
  surface: "#FFFFFF",
} as const;

function candidateAsset(
  symbol: string,
  issuer: string,
  verificationStatus: CandidateVerificationStatus,
  contractSelection?: string,
): PresentationCandidateAsset {
  return {
    symbol,
    issuer,
    selectionStatus: "confirmed-product-default",
    verificationStatus,
    fundingStatus: "disabled",
    source: CURRENCY_DEFAULTS_SOURCE,
    note: `Presentation candidate · ${verificationStatus} · funding disabled`,
    ...(contractSelection ? { contractSelection } : {}),
  };
}

const currencyPresentations = {
  ARS: {
    code: "ARS",
    name: "Argentine peso",
    symbol: "AR$",
    candidateAsset: candidateAsset("wARS", "Ripio", "Additional verification"),
  },
  AUD: {
    code: "AUD",
    name: "Australian dollar",
    symbol: "A$",
    candidateAsset: candidateAsset("AUDD", "AUDC", "Verification pending"),
  },
  BRL: {
    code: "BRL",
    name: "Brazilian real",
    symbol: "R$",
    candidateAsset: candidateAsset("wBRL", "Ripio", "Additional verification"),
  },
  CAD: {
    code: "CAD",
    name: "Canadian dollar",
    symbol: "C$",
    candidateAsset: candidateAsset("CADD", "Tetra Trust", "Additional verification"),
  },
  CHF: {
    code: "CHF",
    name: "Swiss franc",
    symbol: "CHF",
    candidateAsset: candidateAsset("VCHF", "VNX", "Additional verification"),
  },
  CLP: {
    code: "CLP",
    name: "Chilean peso",
    symbol: "CLP$",
    candidateAsset: candidateAsset("wCLP", "Ripio", "Additional verification"),
  },
  COP: {
    code: "COP",
    name: "Colombian peso",
    symbol: "COL$",
    candidateAsset: candidateAsset("wCOP", "Ripio", "Additional verification"),
  },
  EUR: {
    code: "EUR",
    name: "Euro",
    symbol: "€",
    candidateAsset: candidateAsset("EURC", "Circle", "Verification pending"),
  },
  GBP: {
    code: "GBP",
    name: "British pound",
    symbol: "£",
    candidateAsset: candidateAsset(
      "tGBP",
      "BCP Technologies",
      "Verification pending",
    ),
  },
  IDR: {
    code: "IDR",
    name: "Rupiah",
    symbol: "Rp",
    candidateAsset: candidateAsset("IDRX", "IDRX", "Verification pending"),
  },
  MXN: {
    code: "MXN",
    name: "Mexican peso",
    symbol: "MX$",
    candidateAsset: candidateAsset("MXNB", "Juno / Bitso", "Verification pending"),
  },
  MYR: {
    code: "MYR",
    name: "Malaysian ringgit",
    symbol: "RM",
    candidateAsset: candidateAsset("MYRC", "BLOX", "Verification pending"),
  },
  NGN: {
    code: "NGN",
    name: "Nigerian naira",
    symbol: "₦",
    candidateAsset: candidateAsset("cNGN", "cNGN", "Verification pending"),
  },
  NZD: {
    code: "NZD",
    name: "New Zealand dollar",
    symbol: "NZ$",
    candidateAsset: candidateAsset("NZDD", "NZDD", "Verification pending"),
  },
  PEN: {
    code: "PEN",
    name: "Peruvian sol",
    symbol: "S/",
    candidateAsset: candidateAsset("wPEN", "Ripio", "Additional verification"),
  },
  SGD: {
    code: "SGD",
    name: "Singapore dollar",
    symbol: "S$",
    candidateAsset: candidateAsset("XSGD", "StraitsX", "Verification pending"),
  },
  TRY: {
    code: "TRY",
    name: "Turkish lira",
    symbol: "₺",
    candidateAsset: candidateAsset(
      "TRYB",
      "BiLira",
      "Verification pending",
      "Confirmed Base contract: 0xfb8718a69aed7726afb3f04d2bd4bfde1bdcb294, decimals 6.",
    ),
  },
  USD: {
    code: "USD",
    name: "US dollar",
    symbol: "$",
    candidateAsset: candidateAsset("USDC", "Circle", "Verification pending"),
  },
  ZAR: {
    code: "ZAR",
    name: "South African rand",
    symbol: "R",
    candidateAsset: candidateAsset("ZARP", "ZARP", "Verification pending"),
  },
} as const satisfies Record<
  FiatCurrencyCode,
  {
    code: FiatCurrencyCode;
    name: string;
    symbol: string;
    candidateAsset: PresentationCandidateAsset;
  }
>;

type CountryRegionInput = {
  id: CountryCode;
  countryName: string;
  currencyCode: FiatCurrencyCode;
  source?: typeof REGIONAL_MONEY_SOURCE | typeof EURO_AREA_COUNTRIES_SOURCE;
  accent?: string;
  welcome?: PresentationRegion["welcome"];
};

function countryRegion({
  id,
  countryName,
  currencyCode,
  source = REGIONAL_MONEY_SOURCE,
  accent = baseTheme.accent,
  welcome,
}: CountryRegionInput): PresentationRegion {
  const currency = currencyPresentations[currencyCode];

  return {
    id,
    countryCode: id,
    countryName,
    selectorLabel: countryName,
    currency: {
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
    },
    candidateAsset: currency.candidateAsset,
    sources: {
      countryCurrencyMapping: source,
      defaultAsset: CURRENCY_DEFAULTS_SOURCE,
    },
    theme: {
      ...baseTheme,
      accent,
    },
    welcome:
      welcome ??
      {
        eyebrow: `${countryName} · ${currency.code}`,
        title: "Your money, at home.",
        body: "See your actual balance and activity after you sign in.",
      },
  };
}

const euroAreaSource = EURO_AREA_COUNTRIES_SOURCE;

export const presentationRegions = {
  GLOBAL: {
    id: "GLOBAL",
    countryCode: null,
    countryName: "Global",
    selectorLabel: "Global / choose later",
    currency: {
      code: null,
      name: "your local currency",
      symbol: null,
    },
    candidateAsset: null,
    sources: {
      countryCurrencyMapping: null,
      defaultAsset: null,
    },
    theme: baseTheme,
    welcome: {
      eyebrow: "Money on Base",
      title: "Your money, in one place.",
      body: "Choose how money looks, then sign in to see your account.",
    },
  },
  AR: countryRegion({ id: "AR", countryName: "Argentina", currencyCode: "ARS" }),
  AU: countryRegion({ id: "AU", countryName: "Australia", currencyCode: "AUD" }),
  AT: countryRegion({ id: "AT", countryName: "Austria", currencyCode: "EUR", source: euroAreaSource }),
  BE: countryRegion({ id: "BE", countryName: "Belgium", currencyCode: "EUR", source: euroAreaSource }),
  BR: countryRegion({
    id: "BR",
    countryName: "Brazil",
    currencyCode: "BRL",
    accent: "#009C3B",
    welcome: {
      eyebrow: "Brazil · BRL",
      title: "Your reais, at home.",
      body: "See your actual balance and activity after you sign in.",
    },
  }),
  BG: countryRegion({ id: "BG", countryName: "Bulgaria", currencyCode: "EUR", source: euroAreaSource }),
  CA: countryRegion({ id: "CA", countryName: "Canada", currencyCode: "CAD" }),
  CL: countryRegion({ id: "CL", countryName: "Chile", currencyCode: "CLP" }),
  CO: countryRegion({ id: "CO", countryName: "Colombia", currencyCode: "COP" }),
  HR: countryRegion({ id: "HR", countryName: "Croatia", currencyCode: "EUR", source: euroAreaSource }),
  CY: countryRegion({ id: "CY", countryName: "Cyprus", currencyCode: "EUR", source: euroAreaSource }),
  EE: countryRegion({ id: "EE", countryName: "Estonia", currencyCode: "EUR", source: euroAreaSource }),
  FI: countryRegion({ id: "FI", countryName: "Finland", currencyCode: "EUR", source: euroAreaSource }),
  FR: countryRegion({ id: "FR", countryName: "France", currencyCode: "EUR", source: euroAreaSource }),
  DE: countryRegion({ id: "DE", countryName: "Germany", currencyCode: "EUR", source: euroAreaSource }),
  GR: countryRegion({ id: "GR", countryName: "Greece", currencyCode: "EUR", source: euroAreaSource }),
  ID: countryRegion({
    id: "ID",
    countryName: "Indonesia",
    currencyCode: "IDR",
    accent: "#E70011",
    welcome: {
      eyebrow: "Indonesia · IDR",
      title: "Your rupiah, at home.",
      body: "See your actual balance and activity after you sign in.",
    },
  }),
  IE: countryRegion({ id: "IE", countryName: "Ireland", currencyCode: "EUR", source: euroAreaSource }),
  IT: countryRegion({ id: "IT", countryName: "Italy", currencyCode: "EUR", source: euroAreaSource }),
  LV: countryRegion({ id: "LV", countryName: "Latvia", currencyCode: "EUR", source: euroAreaSource }),
  LT: countryRegion({ id: "LT", countryName: "Lithuania", currencyCode: "EUR", source: euroAreaSource }),
  LU: countryRegion({ id: "LU", countryName: "Luxembourg", currencyCode: "EUR", source: euroAreaSource }),
  MY: countryRegion({ id: "MY", countryName: "Malaysia", currencyCode: "MYR" }),
  MT: countryRegion({ id: "MT", countryName: "Malta", currencyCode: "EUR", source: euroAreaSource }),
  MX: countryRegion({ id: "MX", countryName: "Mexico", currencyCode: "MXN" }),
  NL: countryRegion({ id: "NL", countryName: "Netherlands", currencyCode: "EUR", source: euroAreaSource }),
  NZ: countryRegion({ id: "NZ", countryName: "New Zealand", currencyCode: "NZD" }),
  NG: countryRegion({ id: "NG", countryName: "Nigeria", currencyCode: "NGN" }),
  PE: countryRegion({ id: "PE", countryName: "Peru", currencyCode: "PEN" }),
  PT: countryRegion({ id: "PT", countryName: "Portugal", currencyCode: "EUR", source: euroAreaSource }),
  SG: countryRegion({ id: "SG", countryName: "Singapore", currencyCode: "SGD" }),
  SK: countryRegion({ id: "SK", countryName: "Slovakia", currencyCode: "EUR", source: euroAreaSource }),
  SI: countryRegion({ id: "SI", countryName: "Slovenia", currencyCode: "EUR", source: euroAreaSource }),
  ZA: countryRegion({ id: "ZA", countryName: "South Africa", currencyCode: "ZAR" }),
  ES: countryRegion({ id: "ES", countryName: "Spain", currencyCode: "EUR", source: euroAreaSource }),
  CH: countryRegion({ id: "CH", countryName: "Switzerland", currencyCode: "CHF" }),
  TR: countryRegion({ id: "TR", countryName: "Türkiye", currencyCode: "TRY" }),
  GB: countryRegion({ id: "GB", countryName: "United Kingdom", currencyCode: "GBP" }),
  US: countryRegion({
    id: "US",
    countryName: "United States",
    currencyCode: "USD",
    welcome: {
      eyebrow: "United States · USD",
      title: "Your dollars, at home.",
      body: "See your actual balance and activity after you sign in.",
    },
  }),
} satisfies Record<RegionId, PresentationRegion>;

export type ResolutionSource =
  | "explicit"
  | "persisted"
  | "detected"
  | "fallback";

export type ResolvePresentationInput = {
  explicitCountry?: string | null;
  persistedCountry?: string | null;
  detectedCountry?: string | null;
};

export type ResolvedPresentation = {
  region: PresentationRegion;
  source: ResolutionSource;
};

export function isRegionId(value: string | null | undefined): value is RegionId {
  return regionIds.includes(value as RegionId);
}

export function normalizeRegionId(
  value: string | null | undefined,
): RegionId | null {
  const normalized = value?.trim().toUpperCase();
  return isRegionId(normalized) ? normalized : null;
}

function normalizeDetectedCountry(
  value: string | null | undefined,
): CountryCode | null {
  const normalized = normalizeRegionId(value);
  return normalized && normalized !== "GLOBAL" ? normalized : null;
}

function normalizeSelectableRegion(
  value: string | null | undefined,
): CountryCode | null {
  const normalized = normalizeRegionId(value);
  return normalized && normalized !== "GLOBAL" ? normalized : null;
}

export function resolvePresentation({
  explicitCountry,
  persistedCountry,
  detectedCountry,
}: ResolvePresentationInput): ResolvedPresentation {
  const explicit = normalizeSelectableRegion(explicitCountry);
  if (explicit) {
    return { region: presentationRegions[explicit], source: "explicit" };
  }

  const persisted = normalizeSelectableRegion(persistedCountry);
  if (persisted) {
    return { region: presentationRegions[persisted], source: "persisted" };
  }

  const detected = normalizeDetectedCountry(detectedCountry);
  if (detected) {
    return { region: presentationRegions[detected], source: "detected" };
  }

  return { region: presentationRegions.US, source: "fallback" };
}
