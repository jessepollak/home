"use client";

import { useState } from "react";
import { Banknote, Check, ChevronRight, FileText, Globe, Languages, LogOut, Settings, ShieldCheck } from "lucide-react";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { presentationRegions } from "@/config/regions";
import {
  defaultRegionalPreferences,
  regionalDefaults,
  resolveRegionalPreferences,
  type ProposalCountry,
  type ProposalCurrency,
  type ProposalLanguage,
  type RegionalPreferences,
} from "./resolve-regional-preferences";

type Picker = "country" | "language";

const countries: ProposalCountry[] = ["US", "BR", "NG", "ID"];
const currencies: ProposalCurrency[] = ["USD", "BRL", "NGN", "IDR"];
const languages: ProposalLanguage[] = ["English", "Português", "Bahasa Indonesia"];
const noop = () => undefined;

function PreferenceRow({ label, context, value, mark, onClick, actions }: {
  label: string;
  context: string;
  value: string;
  mark: React.ReactNode;
  onClick?: () => void;
  actions?: React.ReactNode;
}) {
  const [displayValue, source] = value.split(" · ");
  return (
    <li>
      <Item className="h-auto min-w-0 flex-nowrap whitespace-normal" render={onClick ? <Button variant="ghost" press="none" onClick={onClick} /> : undefined}>
        <ItemMedia variant="avatar" aria-hidden="true">{mark}</ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle truncate={false} className="w-full min-w-0"><span className="min-w-0 break-words whitespace-normal">{label}</span></ItemTitle>
          {context ? <ItemDescription>{context}</ItemDescription> : null}
        </ItemContent>
        <ItemActions className="min-w-0 max-w-40 shrink-0">
          {actions}
          {!actions && displayValue ? (
            <span aria-label={value} className="flex min-w-0 flex-col items-end text-end text-sm leading-tight text-muted-foreground">
              <span>{displayValue}</span>
              {source ? <span className="text-xs">{source}</span> : null}
            </span>
          ) : null}
          {onClick ? <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" /> : null}
        </ItemActions>
      </Item>
    </li>
  );
}

function PreferenceCard({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-label={heading}>
      <h2 className="text-lg font-semibold">{heading}</h2>
      <Card><CardContent inset="list"><ul className="list-none">{children}</ul></CardContent></Card>
    </section>
  );
}

export function RegionalPreferencesProposal({ initialCountry = "BR", initialPicker = null, initialCurrencyOpen = false, isAdministrator = false, isVerified = true, stressLabels = false, showTitle = true, onSignOut = () => undefined }: {
  initialCountry?: ProposalCountry;
  initialPicker?: Picker | null;
  initialCurrencyOpen?: boolean;
  isAdministrator?: boolean;
  isVerified?: boolean;
  stressLabels?: boolean;
  showTitle?: boolean;
  onSignOut?: () => void;
}) {
  const [preferences, setPreferences] = useState<RegionalPreferences>(() => defaultRegionalPreferences(initialCountry));
  const [picker, setPicker] = useState<Picker>(initialPicker ?? "country");
  const [pickerOpen, setPickerOpen] = useState(initialPicker !== null);
  const openPicker = (next: Picker) => { setPicker(next); setPickerOpen(true); };
  const change = (update: Parameters<typeof resolveRegionalPreferences>[1]) => {
    setPreferences((current) => resolveRegionalPreferences(current, update));
    setPickerOpen(false);
  };
  const country = presentationRegions[preferences.country];
  const currencyName = presentationRegions[countries.find((id) => regionalDefaults[id].currency === preferences.currency.value)!].currency.name;
  const currencySelection = preferences.currency.mode === "country-default" ? "country-default" : preferences.currency.value;
  return (
    <main className="mx-auto w-full max-w-xl space-y-8 px-4 py-6 lg:max-w-2xl lg:py-10">
      {showTitle ? <h1 className="text-2xl font-semibold">Account</h1> : null}
      <PreferenceCard heading="Preferences">
        <PreferenceRow label={stressLabels ? "Land und Verfügbarkeit" : "Country"} context="What's available" value={country.countryName}
          mark={<CurrencyMark currency={country.currency.code} symbol={country.currency.symbol} size="sm" />}
          onClick={() => openPicker("country")} />
        <PreferenceRow label={stressLabels ? "Währung für die Anzeige der Kontostände" : "Display currency"}
          context={preferences.currency.mode === "explicit" ? "Chosen by you" : "Country default"}
          value="" mark={<GlyphMark size="sm"><Banknote /></GlyphMark>}
          actions={<Select value={currencySelection} defaultOpen={initialCurrencyOpen} onValueChange={(value) => {
            if (value === "country-default" || currencies.includes(value as ProposalCurrency)) {
              change({ field: "currency", value: value as ProposalCurrency | "country-default" });
            }
          }}>
            <SelectTrigger aria-label="Display currency" className="min-h-11"><SelectValue>{currencyName}</SelectValue></SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-(--anchor-width)">
              <SelectItem value="country-default">Country default ({country.currency.name})</SelectItem>
              {currencies.filter((code) => code === currencySelection || code !== regionalDefaults[preferences.country].currency).map((code) => <SelectItem key={code} value={code}>
                {presentationRegions[countries.find((id) => regionalDefaults[id].currency === code)!].currency.name}
              </SelectItem>)}
            </SelectContent>
          </Select>} />
        <PreferenceRow label={stressLabels ? "Sprache und Zahlenformate" : "Language"} context="Text and formats"
          value={`${preferences.language.value} · ${preferences.language.mode === "explicit" ? "Chosen by you" : "Country default"}`}
          mark={<GlyphMark size="sm"><Languages /></GlyphMark>} onClick={() => openPicker("language")} />
      </PreferenceCard>
      <PreferenceCard heading="Account">
        <PreferenceRow label="Verification" context="" value={isVerified ? "Verified" : "Not verified"}
          mark={<GlyphMark size="sm"><ShieldCheck /></GlyphMark>} onClick={noop} />
        <PreferenceRow label="Disclosures & terms" context="" value=""
          mark={<GlyphMark size="sm"><FileText /></GlyphMark>} onClick={noop} />
      </PreferenceCard>
      {isAdministrator ? (
        <PreferenceCard heading="Administrator">
          <PreferenceRow label="Operations" context="Coverage and provider status" value=""
            mark={<GlyphMark size="sm"><Settings /></GlyphMark>} onClick={noop} />
        </PreferenceCard>
      ) : null}
      <Button variant="outline" size="lg" className="h-11 w-full" onClick={onSignOut}>
        <LogOut aria-hidden="true" /> Sign out
      </Button>
      <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>{picker === "country" ? "Country" : "Language"}</DrawerTitle></DrawerHeader>
          <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" role="group" aria-label={`${picker} options`}>
            {picker === "country" ? countries.map((id) => (
              <Button key={id} variant="ghost" press="none" size="lg" className="min-h-11 w-full justify-start" aria-pressed={preferences.country === id} onClick={() => change({ field: "country", value: id })}>
                <CurrencyMark currency={presentationRegions[id].currency.code} size="sm" />{presentationRegions[id].countryName}{preferences.country === id ? <Check className="ms-auto size-4" aria-hidden="true" /> : null}
              </Button>
            )) : null}
            {picker === "language" ? (
              <>
                <Button variant="ghost" press="none" size="lg" className="min-h-11 h-auto w-full justify-start whitespace-normal py-2 text-start" aria-pressed={preferences.language.mode === "country-default"} onClick={() => change({ field: "language", value: "country-default" })}>
                  <Globe aria-hidden="true" /><span className="min-w-0 whitespace-normal">Use country default · {regionalDefaults[preferences.country].language}</span>{preferences.language.mode === "country-default" ? <Check className="ms-auto size-4" aria-hidden="true" /> : null}
                </Button>
                {languages.map((language) => (
                  <Button key={language} variant="ghost" press="none" size="lg" className="min-h-11 w-full justify-start" aria-pressed={preferences.language.mode === "explicit" && preferences.language.value === language} onClick={() => change({ field: "language", value: language })}>
                    {language}{preferences.language.mode === "explicit" && preferences.language.value === language ? <Check className="ms-auto size-4" aria-hidden="true" /> : null}
                  </Button>
                ))}
              </>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
