import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  countryDefaultValue,
  RegionalPreferencesProposal,
  type RegionalPreferencesCopy,
  type RegionalPreferencesProposalProps,
  type RegionalPreferencesValue,
} from "./regional-preferences-proposal";

const englishCopy: RegionalPreferencesCopy = {
  country: "Country",
  countryDescription: "Controls eligibility, regional products and local payment rails.",
  displayCurrency: "Display currency",
  displayCurrencyDescription: "Changes presentation only, never assets, balances or transaction intent.",
  language: "Language",
  languageDescription: "Changes Home copy and formatting conventions only.",
  noCountriesFound: "No countries found.",
  preferenceIndependenceDescription: "Country controls availability. Currency and language change presentation only.",
  preferences: "Regional preferences",
  searchCountries: "Search countries",
  useCountryDefault: "Use country default",
};

const countryOptions = [
  { value: "GLOBAL", label: "Global" },
  { value: "US", label: "United States" },
  { value: "BR", label: "Brazil" },
  { value: "NG", label: "Nigeria" },
  { value: "ID", label: "Indonesia" },
] as const;
const currencyOptions = [
  { value: "USD", label: "USD — US dollar" },
  { value: "BRL", label: "BRL — Brazilian real" },
  { value: "NGN", label: "NGN — Nigerian naira" },
  { value: "IDR", label: "IDR — Indonesian rupiah" },
] as const;
const languageOptions = [
  { value: "en", label: "English" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ar", label: "العربية" },
  { value: "id", label: "Bahasa Indonesia" },
] as const;

const countryDefaults: Record<string, { currency: string; language: string }> = {
  GLOBAL: { currency: "USD", language: "English" },
  US: { currency: "USD", language: "English" },
  BR: { currency: "BRL", language: "Português (Brasil)" },
  NG: { currency: "NGN", language: "English" },
  ID: { currency: "IDR", language: "Bahasa Indonesia" },
};

function ControlledPreferences(props: Omit<RegionalPreferencesProposalProps, "value" | "onCountryChange" | "onDisplayCurrencyChange" | "onLanguageChange"> & {
  initialValue: RegionalPreferencesValue;
}) {
  const { initialValue, ...proposalProps } = props;
  const [value, setValue] = useState(initialValue);
  const defaults = countryDefaults[value.country] ?? countryDefaults.GLOBAL;
  return (
    <div>
      <RegionalPreferencesProposal
        {...proposalProps}
        value={value}
        countryDefaultCurrency={defaults.currency}
        countryDefaultLanguage={defaults.language}
        onCountryChange={(country) => setValue((current) => ({ ...current, country }))}
        onDisplayCurrencyChange={(displayCurrency) => setValue((current) => ({ ...current, displayCurrency }))}
        onLanguageChange={(language) => setValue((current) => ({ ...current, language }))}
      />
    </div>
  );
}

const meta = {
  id: "proposal-regional-preferences",
  title: "Proposals/Regional Preferences",
  component: RegionalPreferencesProposal,
  args: {
    copy: englishCopy,
    countryDefaultCurrency: "BRL",
    countryDefaultLanguage: "Português (Brasil)",
    countryOptions,
    currencyOptions,
    languageOptions,
    value: {
      country: "BR",
      displayCurrency: countryDefaultValue,
      language: countryDefaultValue,
    },
    onCountryChange: fn(),
    onDisplayCurrencyChange: fn(),
    onLanguageChange: fn(),
  },
  decorators: [
    (Story) => (
      <main className="min-h-svh bg-muted px-4 py-6 sm:px-8">
        <h1 className="sr-only">Account</h1>
        <Story />
      </main>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof RegionalPreferencesProposal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstUseAlignedDefaults: Story = {};

export const IndependentExplicitChoices: Story = {
  args: {
    value: {
      country: "BR",
      displayCurrency: "USD",
      language: "de",
    },
  },
};

export const ChangeCountryWithoutOverwritingExplicitChoices: Story = {
  args: {
    value: {
      country: "BR",
      displayCurrency: "USD",
      language: "de",
    },
  },
  render: (args) => (
    <ControlledPreferences
      {...args}
      initialValue={args.value}
    />
  ),
};

export const DesktopAccountComposition: Story = {
  args: {
    value: {
      country: "ID",
      displayCurrency: countryDefaultValue,
      language: "fr",
    },
    countryDefaultCurrency: "IDR",
    countryDefaultLanguage: "Bahasa Indonesia",
  },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const GermanLongCopyAtSmallMobile: Story = {
  args: {
    copy: {
      country: "Land oder Region",
      countryDescription: "Bestimmt Berechtigung, regionale Produkte und verfügbare lokale Zahlungswege.",
      displayCurrency: "Anzeigewährung",
      displayCurrencyDescription: "Ändert ausschließlich die Darstellung und niemals Vermögenswerte, Guthaben oder Transaktionsabsichten.",
      language: "Sprache der Benutzeroberfläche",
      languageDescription: "Ändert nur Texte und Formatierungskonventionen in Home.",
      noCountriesFound: "Keine Länder gefunden.",
      preferenceIndependenceDescription: "Das Land bestimmt die Verfügbarkeit. Währung und Sprache ändern nur die Darstellung.",
      preferences: "Regionale Einstellungen",
      searchCountries: "Länder suchen",
      useCountryDefault: "Ländervoreinstellung verwenden",
    },
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const FrenchAtTwoHundredPercentText: Story = {
  args: {
    copy: {
      country: "Pays ou région",
      countryDescription: "Détermine l’éligibilité, les produits régionaux et les moyens de paiement locaux.",
      displayCurrency: "Devise d’affichage",
      displayCurrencyDescription: "Modifie uniquement la présentation, jamais les actifs, les soldes ou l’intention d’une transaction.",
      language: "Langue de l’interface",
      languageDescription: "Modifie uniquement les textes de Home et les conventions de formatage.",
      noCountriesFound: "Aucun pays trouvé.",
      preferenceIndependenceDescription: "Le pays détermine la disponibilité. La devise et la langue modifient uniquement la présentation.",
      preferences: "Préférences régionales",
      searchCountries: "Rechercher un pays",
      useCountryDefault: "Utiliser la valeur par défaut du pays",
    },
  },
  render: (args) => (
    <div className="w-1/2" style={{ zoom: 2 }} data-text-scale="200%">
      <RegionalPreferencesProposal {...args} />
    </div>
  ),
};

export const RightToLeftDirection: Story = {
  args: {
    value: { country: "GLOBAL", displayCurrency: "USD", language: "ar" },
  },
  render: (args) => (
    <div dir="rtl">
      <RegionalPreferencesProposal {...args} />
    </div>
  ),
};

export const KeyboardFocusAndCountryDefaultActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("combobox", { name: "Country" })).toHaveFocus();
    await userEvent.tab();
    const currency = canvas.getByRole("combobox", { name: "Display currency" });
    await expect(currency).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Escape}");
    await expect(currency).toHaveFocus();
  },
};

export const ReducedMotionReference: Story = {
  parameters: {
    docs: {
      description: {
        story: "Review with prefers-reduced-motion enabled. Select and focus feedback remains immediate without spatial motion.",
      },
    },
  },
};
