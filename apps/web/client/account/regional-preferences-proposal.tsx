"use client";

import { useState } from "react";
import { Globe2, Languages, RotateCcw, WalletCards } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const countryDefaultValue = "country-default";

export type RegionalPreferenceOption = {
  value: string;
  label: string;
};

export type RegionalPreferencesValue = {
  country: string;
  displayCurrency: string | typeof countryDefaultValue;
  language: string | typeof countryDefaultValue;
};

export type RegionalPreferencesCopy = {
  country: string;
  countryDescription: string;
  displayCurrency: string;
  displayCurrencyDescription: string;
  language: string;
  languageDescription: string;
  noCountriesFound: string;
  preferenceIndependenceDescription: string;
  preferences: string;
  searchCountries: string;
  useCountryDefault: string;
};

export type RegionalPreferencesProposalProps = {
  copy: RegionalPreferencesCopy;
  countryDefaultCurrency: string;
  countryDefaultLanguage: string;
  countryOptions: readonly RegionalPreferenceOption[];
  currencyOptions: readonly RegionalPreferenceOption[];
  languageOptions: readonly RegionalPreferenceOption[];
  onCountryChange: (country: string) => void;
  onDisplayCurrencyChange: (currency: string | typeof countryDefaultValue) => void;
  onLanguageChange: (language: string | typeof countryDefaultValue) => void;
  value: RegionalPreferencesValue;
};

function CountryPreferenceCombobox({
  ariaLabel,
  emptyLabel,
  onValueChange,
  options,
  searchPlaceholder,
  value,
}: {
  ariaLabel: string;
  emptyLabel: string;
  onValueChange: (value: string) => void;
  options: readonly RegionalPreferenceOption[];
  searchPlaceholder: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox
      items={options}
      value={selected}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue.value);
          setOpen(false);
        }
      }}
    >
      <ComboboxInput
        aria-label={ariaLabel}
        placeholder={searchPlaceholder}
        className="min-h-11 w-full min-w-0 sm:max-w-56"
        showTrigger={false}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option: RegionalPreferenceOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function PreferenceSelect({
  ariaLabel,
  defaultDetail,
  defaultLabel,
  onValueChange,
  options,
  value,
}: {
  ariaLabel: string;
  defaultDetail?: string;
  defaultLabel?: string;
  onValueChange: (value: string) => void;
  options: readonly RegionalPreferenceOption[];
  value: string;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col items-end gap-1 sm:w-auto">
      <Select value={value} onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue);
      }}>
        <SelectTrigger className="min-h-11 w-full max-w-full" aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {defaultLabel ? (
            <SelectItem value={countryDefaultValue}>
              <RotateCcw aria-hidden />
              {defaultLabel}
            </SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === countryDefaultValue && defaultDetail ? (
        <span className="max-w-52 text-right text-xs text-muted-foreground">{defaultDetail}</span>
      ) : null}
    </div>
  );
}

export function RegionalPreferencesProposal({
  copy,
  countryDefaultCurrency,
  countryDefaultLanguage,
  countryOptions,
  currencyOptions,
  languageOptions,
  onCountryChange,
  onDisplayCurrencyChange,
  onLanguageChange,
  value,
}: RegionalPreferencesProposalProps) {
  return (
    <section className="mx-auto w-full max-w-2xl space-y-3" aria-labelledby="regional-preferences-heading">
      <div className="space-y-1">
        <h2 id="regional-preferences-heading" className="text-lg font-semibold">{copy.preferences}</h2>
        <p className="text-sm text-foreground">
          {copy.preferenceIndependenceDescription}
        </p>
      </div>
      <Card>
        <CardContent inset="list">
          <Item className="min-w-0 items-start sm:flex-nowrap sm:items-center">
            <ItemMedia variant="avatar"><Globe2 aria-hidden /></ItemMedia>
            <ItemContent className="min-w-48">
              <ItemTitle>{copy.country}</ItemTitle>
              <ItemDescription>{copy.countryDescription}</ItemDescription>
            </ItemContent>
            <ItemActions className="min-w-0 basis-full justify-end sm:basis-auto">
              <CountryPreferenceCombobox
                ariaLabel={copy.country}
                emptyLabel={copy.noCountriesFound}
                options={countryOptions}
                searchPlaceholder={copy.searchCountries}
                value={value.country}
                onValueChange={onCountryChange}
              />
            </ItemActions>
          </Item>
          <ItemSeparator className="my-0" />
          <Item className="min-w-0 items-start sm:flex-nowrap sm:items-center">
            <ItemMedia variant="avatar"><WalletCards aria-hidden /></ItemMedia>
            <ItemContent className="min-w-48">
              <ItemTitle>{copy.displayCurrency}</ItemTitle>
              <ItemDescription>{copy.displayCurrencyDescription}</ItemDescription>
            </ItemContent>
            <ItemActions className="min-w-0 basis-full justify-end sm:basis-auto">
              <PreferenceSelect
                ariaLabel={copy.displayCurrency}
                defaultDetail={countryDefaultCurrency}
                defaultLabel={copy.useCountryDefault}
                options={currencyOptions}
                value={value.displayCurrency}
                onValueChange={onDisplayCurrencyChange}
              />
            </ItemActions>
          </Item>
          <ItemSeparator className="my-0" />
          <Item className="min-w-0 items-start sm:flex-nowrap sm:items-center">
            <ItemMedia variant="avatar"><Languages aria-hidden /></ItemMedia>
            <ItemContent className="min-w-48">
              <ItemTitle>{copy.language}</ItemTitle>
              <ItemDescription>{copy.languageDescription}</ItemDescription>
            </ItemContent>
            <ItemActions className="min-w-0 basis-full justify-end sm:basis-auto">
              <PreferenceSelect
                ariaLabel={copy.language}
                defaultDetail={countryDefaultLanguage}
                defaultLabel={copy.useCountryDefault}
                options={languageOptions}
                value={value.language}
                onValueChange={onLanguageChange}
              />
            </ItemActions>
          </Item>
        </CardContent>
      </Card>
    </section>
  );
}
