"use client";

import { Banknote } from "lucide-react";
import { GlyphMark } from "@/components/currency-mark";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RegionId } from "@/config/regions";
import {
  COUNTRY_DEFAULT_CURRENCY,
  countryDefaultCurrency,
  offeredDisplayCurrencies,
  parseDisplayCurrencyChoice,
  type DisplayCurrencyChoice,
  type ResolvedDisplayCurrency,
} from "@/shared/account/display-currency";
import { presentationCurrencyName } from "@/shared/formatting/presentation-fiat";

export function DisplayCurrencyRow({
  regionId,
  displayCurrency,
  onDisplayCurrencyChange,
  message,
  writeFailed,
  onRetryWrite,
  isPreferenceReady,
}: {
  regionId: RegionId;
  displayCurrency: ResolvedDisplayCurrency;
  onDisplayCurrencyChange: (choice: DisplayCurrencyChoice) => void;
  message: string;
  writeFailed: boolean;
  onRetryWrite: () => void;
  isPreferenceReady: boolean;
}) {
  const countryCurrency = countryDefaultCurrency(regionId);
  const selection: DisplayCurrencyChoice =
    displayCurrency.source === "explicit" && displayCurrency.currency ? displayCurrency.currency : COUNTRY_DEFAULT_CURRENCY;
  const options = offeredDisplayCurrencies
    .map((code) => ({ code, name: presentationCurrencyName(code) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const triggerLabel = displayCurrency.currency ? presentationCurrencyName(displayCurrency.currency) : "No currency yet";
  const withdrawnMessage = displayCurrency.withdrawn
    ? `Your saved currency (${displayCurrency.withdrawn}) is no longer offered.`
    : "";
  const status = isPreferenceReady
    ? [withdrawnMessage, message].filter(Boolean).join(" ")
    : "Checking saved country preference.";

  return (
    <>
      <Item className="min-w-0 flex-nowrap items-center">
        <ItemMedia className="self-center translate-y-0" aria-hidden="true">
          <GlyphMark><Banknote /></GlyphMark>
        </ItemMedia>
        <ItemContent className="min-w-0 flex-1">
          <ItemTitle truncate={false} className="w-full min-w-0">
            <span className="min-w-0 break-words whitespace-normal">Display currency</span>
          </ItemTitle>
          <ItemDescription>{displayCurrency.source === "explicit" ? "Chosen by you" : "Country default"}</ItemDescription>
          <ItemDescription id="display-currency-status" role="status" aria-live="polite">{status}</ItemDescription>
        </ItemContent>
        <ItemActions className="min-w-0 shrink justify-end">
          <Select
            value={selection}
            disabled={!isPreferenceReady}
            onValueChange={(value) => {
              const choice = parseDisplayCurrencyChoice(value);
              if (choice) onDisplayCurrencyChange(choice);
            }}
          >
            <SelectTrigger aria-label="Display currency" aria-describedby="display-currency-status" className="min-h-11 w-auto min-w-0 max-w-40">
              <SelectValue className="min-w-0">{triggerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectItem value={COUNTRY_DEFAULT_CURRENCY}>
                {countryCurrency ? `Country default (${presentationCurrencyName(countryCurrency)})` : "Country default"}
              </SelectItem>
              {options.map((option) => (
                <SelectItem key={option.code} value={option.code}>{option.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {writeFailed && isPreferenceReady ? (
        <Item className="min-w-0 flex-wrap items-center justify-end">
          <ItemActions>
            <Button variant="outline" size="touch" aria-describedby="display-currency-status" onClick={onRetryWrite}>
              Try again
            </Button>
          </ItemActions>
        </Item>
      ) : null}
    </>
  );
}
